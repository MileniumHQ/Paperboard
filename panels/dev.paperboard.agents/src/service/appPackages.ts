// Packages for the agent's apps, from the npm registry: the part of
// `npm install` a browser app needs, without npm. Versions are picked with
// semver and laid out the way Node finds them (hoisted to the top of
// node_modules unless two versions clash). Every tarball must match the
// registry's sha512 for it, and only its regular files are unpacked: no
// links, no paths leaving the package, and no install scripts, ever. The
// whole node_modules is built aside and swapped in when it's complete.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type Semver from "semver";

export const REGISTRY = "https://registry.npmjs.org";
const MAX_PACKAGES = 500;
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
const FETCH_MS = 30_000;
const DOWNLOADS_AT_ONCE = 8;
// old packages may have capitals in their names
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

interface Version {
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    optionalDependencies?: Record<string, string>;
    dist: { tarball: string; integrity?: string };
}
interface Packument {
    "dist-tags": Record<string, string>;
    versions: Record<string, Version>;
}

/** "react", "react@19", "@tanstack/react-query@^5": its name and the version, range or tag asked for. */
export function parseSpec(spec: unknown): { name: string; range: string | null } {
    if (typeof spec !== "string" || !spec.trim()) throw new Error("give a package, e.g. react or react@19");
    const s = spec.trim();
    const at = s.indexOf("@", s.startsWith("@") ? 1 : 0);
    const name = at > 0 ? s.slice(0, at) : s;
    const range = at > 0 ? s.slice(at + 1) : null;
    if (name.length > 214 || !NAME.test(name)) throw new Error(`${s} isn't a package name from the npm registry`);
    if (range !== null && !range) throw new Error(`give ${name} a version after the @, or leave the @ out`);
    return { name, range };
}

function versionOf(semver: typeof Semver, name: string, range: string, p: Packument): Version {
    const tagged = p["dist-tags"][range];
    if (tagged && p.versions[tagged]) return p.versions[tagged];
    if (!semver.validRange(range)) throw new Error(`${name}@${range} isn't from the npm registry (only versions, ranges and tags are)`);
    // what npm picks: latest when it fits, else the newest that does
    const latest = p["dist-tags"].latest;
    const version = latest && semver.satisfies(latest, range) ? latest : semver.maxSatisfying(Object.keys(p.versions), range);
    if (!version) throw new Error(`no version of ${name} matches ${range}`);
    return p.versions[version]!;
}

async function get(url: string, accept: string): Promise<Response> {
    let res: Response;
    try {
        res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(FETCH_MS) });
    } catch (e) {
        throw new Error(`couldn't reach the npm registry (${e instanceof Error ? e.message : String(e)})`);
    }
    return res;
}

/** The files of a .tgz: regular files only, named as in the package (its first folder dropped). */
export function unpack(tgz: Buffer, maxBytes: number): { path: string; data: Buffer }[] {
    const tar = zlib.gunzipSync(tgz, { maxOutputLength: maxBytes });
    const text = (b: Buffer, at: number, len: number) => {
        const s = b.subarray(at, at + len);
        const end = s.indexOf(0);
        return (end < 0 ? s : s.subarray(0, end)).toString("utf8");
    };
    const out: { path: string; data: Buffer }[] = [];
    let longName: string | null = null;
    let paxPath: string | null = null;
    for (let off = 0; off + 512 <= tar.length; ) {
        const h = tar.subarray(off, off + 512);
        if (h.every((b) => b === 0)) break;
        if (h[124]! & 0x80) throw new Error("a file in the package is too big to unpack");
        const size = parseInt(text(h, 124, 12).trim() || "0", 8);
        if (!Number.isFinite(size) || size < 0) throw new Error("the package's archive is damaged");
        const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]!);
        const ustar = text(h, 257, 6).startsWith("ustar");
        const prefix = ustar ? text(h, 345, 155) : "";
        let name = prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100);
        const body = tar.subarray(off + 512, off + 512 + size);
        if (body.length < size) throw new Error("the package's archive is cut short");
        off += 512 + Math.ceil(size / 512) * 512;
        if (type === "L") {
            longName = text(body, 0, body.length);
            continue;
        }
        if (type === "x") {
            for (const line of body.toString("utf8").split("\n")) {
                const m = line.match(/^\d+ path=(.*)$/);
                if (m) paxPath = m[1]!;
            }
            continue;
        }
        if (type === "g") continue;
        name = paxPath ?? longName ?? name;
        paxPath = longName = null;
        // regular files only: links, devices and the rest are left out
        if (type !== "0" && type !== "7") continue;
        const rel = path.posix.normalize(name.split("/").slice(1).join("/"));
        if (!rel || rel === "." || rel.startsWith("/") || rel.split("/").includes("..") || /[\\:\0]/.test(rel)) {
            throw new Error(`the package has a file named ${JSON.stringify(name)}, which can't be unpacked safely`);
        }
        out.push({ path: rel, data: Buffer.from(body) });
    }
    return out;
}

/** Where a package's folder is in the one depending on it: node_modules/a/node_modules/b → node_modules/a. */
function parentOf(dir: string): string {
    const i = dir.lastIndexOf("node_modules/");
    return i <= 0 ? "" : dir.slice(0, i - 1);
}

export interface Installed {
    /** what package.json asked for, with the version each got */
    direct: { name: string; version: string }[];
    /** all packages laid out, those included */
    count: number;
}

/**
 * Installs an app's packages: those package.json lists plus `add`, which it
 * then lists too. `appDir` must be a folder already checked to be the app's.
 */
export async function installPackages(appDir: string, add: string[], registry = REGISTRY): Promise<Installed> {
    // only an install reads version ranges, so semver is loaded with one
    const { default: semver } = await import("semver");
    const pjPath = path.join(appDir, "package.json");
    let pj: Record<string, unknown>;
    try {
        pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    } catch {
        throw new Error("the app's package.json is missing or isn't valid JSON");
    }
    if (!pj || typeof pj !== "object" || Array.isArray(pj)) throw new Error("the app's package.json isn't a JSON object");
    const listed = pj.dependencies && typeof pj.dependencies === "object" ? { ...(pj.dependencies as Record<string, string>) } : {};
    const asked = add.map(parseSpec);
    for (const a of asked) listed[a.name] = a.range ?? "latest";
    for (const [name, range] of Object.entries(listed)) {
        if (typeof range !== "string") throw new Error(`package.json's dependencies list ${name} without a version`);
        parseSpec(`${name}@${range}`);
    }

    const packuments = new Map<string, Promise<Packument>>();
    const packument = (name: string) => {
        let p = packuments.get(name);
        if (!p) {
            p = (async () => {
                const res = await get(`${registry}/${name.replace("/", "%2f")}`, "application/vnd.npm.install-v1+json");
                if (res.status === 404) throw new Error(`there's no package called ${name} on the npm registry`);
                if (!res.ok) throw new Error(`the npm registry answered ${res.status} for ${name}`);
                return (await res.json()) as Packument;
            })();
            packuments.set(name, p);
        }
        return p;
    };

    // the layout: an install folder (node_modules/a/node_modules/b) → what's there
    const placed = new Map<string, Version & { name: string }>();
    let wave: { name: string; range: string; from: string; peer?: boolean }[] = Object.entries(listed).map(([name, range]) => ({ name, range, from: "" }));
    while (wave.length) {
        await Promise.all(wave.map((d) => packument(d.name)));
        const next: typeof wave = [];
        for (const d of wave) {
            // Node takes the first one found walking up: if that one fits, it's done
            let found: (Version & { name: string }) | undefined;
            for (let dir = d.from; ; dir = parentOf(dir)) {
                found = placed.get(path.posix.join(dir, "node_modules", d.name));
                if (found || !dir) break;
            }
            const v = versionOf(semver, d.name, d.range, await packument(d.name));
            if (found && (found.version === v.version || (semver.validRange(d.range) && semver.satisfies(found.version, d.range)))) continue;
            // a second copy of a peer (two Reacts) breaks the app in ways nothing reports
            if (found && d.peer) {
                throw new Error(`${placed.get(d.from)!.name} needs ${d.name}@${d.range}, and the app has ${d.name}@${found.version}: add a version of one that fits the other`);
            }
            // nothing on the way up: at the top for all to share; a clash: beside the one that needs it
            const at = found ? path.posix.join(d.from, "node_modules", d.name) : path.posix.join("node_modules", d.name);
            placed.set(at, { ...v, name: d.name });
            if (placed.size > MAX_PACKAGES) throw new Error(`that's more than ${MAX_PACKAGES} packages; an app needs far fewer`);
            const optional = v.optionalDependencies ?? {};
            for (const [name, range] of Object.entries(v.dependencies ?? {})) {
                // optional ones are mostly native builds for Node, which a browser can't use
                if (!(name in optional)) next.push({ name, range, from: at });
            }
            for (const [name, range] of Object.entries(v.peerDependencies ?? {})) {
                if (!v.peerDependenciesMeta?.[name]?.optional) next.push({ name, range, from: at, peer: true });
            }
        }
        for (const d of next) {
            if (!NAME.test(d.name)) throw new Error(`a package depends on ${d.name}, which isn't a package name from the npm registry`);
            if (!semver.validRange(d.range) && !/^[a-z][\w.-]*$/i.test(d.range)) {
                throw new Error(`a package depends on ${d.name} from "${d.range}", which isn't the npm registry`);
            }
        }
        wave = next;
    }

    const stage = path.join(appDir, `.node_modules-${randomBytes(4).toString("hex")}`);
    let unpacked = 0;
    try {
        const all = [...placed.entries()];
        for (let i = 0; i < all.length; i += DOWNLOADS_AT_ONCE) {
            // all of them settle before any failure is thrown: nothing is still writing when the stage is removed
            const settled = await Promise.allSettled(
                all.slice(i, i + DOWNLOADS_AT_ONCE).map(async ([at, v]) => {
                    const id = `${v.name}@${v.version}`;
                    if (!v.dist.tarball.startsWith(`${registry}/`)) throw new Error(`${id} is served from outside the npm registry`);
                    const integrity = v.dist.integrity?.match(/^sha512-([A-Za-z0-9+/=]+)$/);
                    if (!integrity) throw new Error(`${id} has no sha512 to check it against; it's too old to install safely`);
                    const res = await get(v.dist.tarball, "application/octet-stream");
                    if (!res.ok) throw new Error(`the npm registry answered ${res.status} for ${id}`);
                    if (Number(res.headers.get("content-length") ?? 0) > MAX_TARBALL_BYTES) throw new Error(`${id} is too big for an app`);
                    const tgz = Buffer.from(await res.arrayBuffer());
                    if (tgz.length > MAX_TARBALL_BYTES) throw new Error(`${id} is too big for an app`);
                    if (createHash("sha512").update(tgz).digest("base64") !== integrity[1]) throw new Error(`${id} doesn't match the registry's checksum; nothing was installed`);
                    const files = unpack(tgz, MAX_UNPACKED_BYTES);
                    for (const f of files) {
                        unpacked += f.data.length;
                        if (unpacked > MAX_UNPACKED_BYTES) throw new Error("those packages are too big for an app");
                        const full = path.join(stage, ...at.split("/").slice(1), ...f.path.split("/"));
                        fs.mkdirSync(path.dirname(full), { recursive: true });
                        fs.writeFileSync(full, f.data);
                    }
                    if (!files.some((f) => f.path === "package.json")) throw new Error(`${id} came without its package.json`);
                }),
            );
            const failed = settled.find((r) => r.status === "rejected");
            if (failed) throw failed.reason;
        }
        fs.mkdirSync(stage, { recursive: true });
        fs.rmSync(path.join(appDir, "node_modules"), { recursive: true, force: true });
        fs.renameSync(stage, path.join(appDir, "node_modules"));
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }

    const direct = Object.keys(listed).map((name) => ({ name, version: placed.get(`node_modules/${name}`)!.version }));
    // what was asked for by tag or not at all is kept as a range from the version it got
    for (const a of asked) {
        const got = direct.find((d) => d.name === a.name)!.version;
        listed[a.name] = a.range && semver.validRange(a.range) ? a.range : `^${got}`;
    }
    pj.dependencies = Object.fromEntries(Object.entries(listed).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(pjPath, `${JSON.stringify(pj, null, 2)}\n`);
    return { direct, count: placed.size };
}
