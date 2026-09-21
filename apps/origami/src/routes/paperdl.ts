import { jsonResponse, type Env } from "../lib";

// Versioned binary downloads. Binaries live on GitHub Releases; Origami
// only 302-redirects to them and serves the small metadata (latest.yml
// feeds) from R2. It never proxies bytes.
//
// Canonical facts duplicated in apps/paperboard/devutils/publishLib.ts
// (the worker cannot import devutils): DOWNLOAD_HOST, GH_REPO, the
// /<app>/<version|latest>/<file> redirect contract, VERSION_SEGMENT,
// FILE_SEGMENT, the <app>-v<version> tag scheme, and the canonical asset
// names below. Change both sides together.
export const DOWNLOAD_HOST = "i.paperboard.dev";
const GH_REPO = "MileniumHQ/Paperboard";

// URL path segments: "pb" is the Paperboard app, "crane" the server.
const DL_APPS = new Set(["pb", "crane"]);

// A version or filename sits inside a URL path slot here and inside the
// redirect target, so neither may contain "/", whitespace, "%", "?", or
// "#". "latest" matches VERSION_SEGMENT on purpose — the router checks the
// alias before the versioned route.
const VERSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$/;
const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,127}$/;

export function isDownloadHost(hostname: string): boolean {
    return hostname.toLowerCase() === DOWNLOAD_HOST;
}

interface DlAppRecord {
    latest: string;
    versions: Record<string, { files: { file: string }[] }>;
}

async function readDlRecord(env: Env, app: string): Promise<DlAppRecord | null> {
    const rec = (await env.PACKAGES.get(`dl/${app}`, {
        type: "json",
    })) as DlAppRecord | null;
    if (!rec) return null;
    if (
        typeof rec.latest !== "string" ||
        typeof rec.versions !== "object" ||
        rec.versions === null
    ) {
        // A malformed record is a server-side data error, not a 404: the
        // outer handler turns this into a 500 with the detail in the logs.
        throw new Error(`dl/${app} record has unexpected shape`);
    }
    return rec;
}

// Resolve (app, version|latest, file) to a GitHub release asset URL, or
// null when the version or file is not in the database. The KV record is
// the source of truth: unknown versions and unrecorded files are 404s,
// never fabricated redirects.
function resolveDownloadUrl(
    rec: DlAppRecord | null,
    app: string,
    versionOrLatest: string,
    file: string,
): { url: string; immutable: boolean } | null {
    if (!rec) return null;
    if (!FILE_SEGMENT.test(file)) return null;
    let version = versionOrLatest;
    let immutable = true;
    if (version === "latest") {
        version = rec.latest;
        immutable = false;
        if (!version || !VERSION_SEGMENT.test(version)) return null;
    } else if (!VERSION_SEGMENT.test(version)) {
        return null;
    }
    const entry = rec.versions[version];
    if (
        !entry ||
        !Array.isArray(entry.files) ||
        !entry.files.some((f) => f?.file === file)
    ) {
        return null;
    }
    const tag = `${app}-v${version}`;
    return {
        url: `https://github.com/${GH_REPO}/releases/download/${tag}/${file}`,
        immutable,
    };
}

function redirectResponse(url: string, immutable: boolean): Response {
    const headers = new Headers({
        Location: url,
        "Access-Control-Allow-Origin": "*",
    });
    // Versioned URLs are immutable; the "latest" alias moves, so it must
    // not be cached.
    headers.set(
        "Cache-Control",
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
    );
    return new Response(null, { status: 302, headers });
}

async function serveDownloadRedirect(
    env: Env,
    app: string,
    versionOrLatest: string,
    file: string,
): Promise<Response> {
    const rec = await readDlRecord(env, app);
    const r = resolveDownloadUrl(rec, app, versionOrLatest, file);
    if (!r) return jsonResponse({ error: "Not found" }, 404);
    return redirectResponse(r.url, r.immutable);
}

async function serveR2Yml(env: Env, name: string): Promise<Response> {
    const dl = env.PAPERDL_BUCKET;
    if (!dl) {
        return jsonResponse({ error: "PAPERDL_BUCKET not configured" }, 500);
    }
    const obj = await dl.get(`pb/${name}`);
    if (!obj) return jsonResponse({ error: "Not found" }, 404);
    return new Response(obj.body, {
        headers: {
            "Content-Type": "text/yaml; charset=utf-8",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    });
}

// i.paperboard.dev is downloads-only: feeds, short download routes, and
// nothing else. Every other path falls through to the host's 404, so the
// registry, panels, java, and publish routes are unreachable here.
export async function handleDownloadHostRoutes(
    request: Request,
    env: Env,
    pathname: string,
): Promise<Response | null> {
    if (request.method !== "GET") return null;
    if (
        pathname === "/pb/latest.yml" ||
        pathname === "/pb/latest-mac.yml" ||
        pathname === "/pb/latest-linux.yml"
    ) {
        return serveR2Yml(env, pathname.slice("/pb/".length));
    }
    const m = pathname.match(/^\/(pb|crane)\/([^/]+)\/([^/]+)$/);
    if (!m) return null;
    const [, app, versionOrLatest, file] = m;
    if (!app || !DL_APPS.has(app) || !versionOrLatest || !file) return null;
    return serveDownloadRedirect(env, app, versionOrLatest, file);
}

// Canonical asset filename per legacy target, for the old
// /paperdl/<app>/<target>/download routes which now 302 to the new
// scheme. Unknown targets return null (genuine 404, never fabricated).
function legacyRedirectTarget(
    app: "paperboard" | "crane",
    target: string,
): { seg: string; file: string } | null {
    const pbFiles: Record<string, string> = {
        "linux-x64": "paperboard-linux-x64.AppImage",
        "linux-arm64": "paperboard-linux-arm64.AppImage",
        "macos-x64": "paperboard-macos-x64.zip",
        "macos-arm64": "paperboard-macos-arm64.zip",
        "windows-x64": "paperboard-windows-x64-setup.exe",
    };
    if (app === "paperboard") {
        const file = pbFiles[target];
        return file ? { seg: "pb", file } : null;
    }
    if (/^(linux|macos)-(x64|arm64)$/.test(target) || target === "windows-x64") {
        const ext = target === "windows-x64" ? "zip" : "tar.gz";
        return { seg: "crane", file: `crane-${target}.${ext}` };
    }
    return null;
}

export async function handlePaperdlRoutes(
    request: Request,
    env: Env,
    _url: URL,
    pathname: string,
    _bucket: R2Bucket | undefined,
): Promise<Response | null> {
    // New versioned scheme, mirroring i.paperboard.dev under /paperdl/.
    const scheme = pathname.match(/^\/paperdl\/(pb|crane)(\/.*)?$/);
    if (scheme) {
        const app = scheme[1];
        const sub = scheme[2] || "";
        if (
            request.method === "GET" &&
            (sub === "/latest.yml" || sub === "/latest-mac.yml" || sub === "/latest-linux.yml")
        ) {
            return serveR2Yml(env, sub.slice(1));
        }
        const m =
            request.method === "GET" ? sub.match(/^\/([^/]+)\/([^/]+)$/) : null;
        if (m) {
            const [, versionOrLatest, file] = m;
            if (!app || !versionOrLatest || !file) return null;
            const redir = await serveDownloadRedirect(env, app, versionOrLatest, file);
            if (redir.status !== 404) return redir;
            // "/paperdl/crane/<target>/download" predates the versioned
            // scheme and collides with it segment-for-segment. The version
            // database wins (a recorded version+file always resolves
            // first); only an unresolvable path with a real legacy target
            // falls back to the legacy redirect. "pb" never had this URL
            // shape, so it keeps the genuine 404.
            if (app === "crane") {
                const leg = sub.match(/^\/([A-Za-z0-9_\-]+)\/download(?:\/.*)?$/);
                if (leg && leg[1]) {
                    const r = legacyRedirectTarget("crane", leg[1]);
                    if (r) {
                        const headers = new Headers({
                            Location: `https://${DOWNLOAD_HOST}/${r.seg}/latest/${r.file}`,
                            "Access-Control-Allow-Origin": "*",
                            "Cache-Control": "no-cache",
                        });
                        return new Response(null, { status: 302, headers });
                    }
                }
            }
            return redir;
        }
        return null;
    }

    const paperdlMatch = pathname.match(
        /^\/paperdl\/(crane|paperboard)(\/.*)?$/,
    );
    if (paperdlMatch) {
        const app = paperdlMatch[1] as "crane" | "paperboard";
        const sub = paperdlMatch[2] || "";
        const dl = env.PAPERDL_BUCKET;

        if (
            request.method === "GET" &&
            (sub === "/index.json" || sub === "" || sub === "/")
        ) {
            if (!dl) {
                return jsonResponse(
                    { error: "PAPERDL_BUCKET not configured" },
                    500,
                );
            }
            const obj = await dl.get(`${app}/index.json`);
            if (!obj) return jsonResponse({});
            const text = await obj.text();
            return new Response(text, {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

        if (
            request.method === "GET" &&
            app === "paperboard" &&
            (sub === "/latest.yml" ||
                sub === "/latest-mac.yml" ||
                sub === "/latest-linux.yml")
        ) {
            // Legacy feed path serves the current feed (now under pb/ so
            // old installs keep updating; the orphaned paperboard/*.yml
            // objects in R2 are frozen history, not served).
            return serveR2Yml(env, sub.slice(1));
        }

        // Legacy per-target download: 302 to the canonical file under the
        // new scheme so existing installs and links keep working.
        const dlMatch = sub.match(/^\/([a-zA-Z0-9_\-]+)\/download(?:\/.*)?$/);
        if (request.method === "GET" && dlMatch && dlMatch[1]) {
            const redir = legacyRedirectTarget(app, dlMatch[1]);
            if (!redir) return jsonResponse({ error: "Not found" }, 404);
            const headers = new Headers({
                Location: `https://${DOWNLOAD_HOST}/${redir.seg}/latest/${redir.file}`,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            });
            return new Response(null, { status: 302, headers });
        }
    }

    return null;
}
