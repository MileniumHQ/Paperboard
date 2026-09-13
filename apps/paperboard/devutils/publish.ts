#!/usr/bin/env bun
/**
 * publish.ts — Build and (optionally) publish Paperboard, PaperCrane, or any Board/Panel to Origami
 *
 * Builds by default. Nothing leaves the machine unless --publish is passed.
 *
 * Usage:
 *   ./publish.ts pb                            # Build Paperboard desktop app
 *   ./publish.ts crane                         # Build PaperCrane daemon binary
 *   ./publish.ts dev.paperboard.terminal       # Build a board / panel
 *   ./publish.ts gameserver                    # Also matches ../dev.paperboard.gameserver
 *   ./publish.ts usb                           # Build everything into ../usb/ for sneakernet testing
 *   ./publish.ts pb --all --publish            # Build + upload Paperboard for every target
 */

import { $, S3Client } from "bun";
import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync, mkdirSync, rmSync, cpSync, statSync } from "fs";
import { join, basename, resolve } from "path";
import { tmpdir } from "os";
import * as tar from "tar";
import { resolvePublishTarget } from "./publishManifest";

const targetArg = process.argv[2];
if (!targetArg || targetArg === "--help" || targetArg === "-h") {
    console.error(`
Usage:
  ./publish.ts pb                         Build Paperboard app binary
  ./publish.ts crane                      Build PaperCrane daemon binary
  ./publish.ts <board-id | folder-name>   Build a Board / Panel
  ./publish.ts usb                        Build everything into ../usb/ for testing

  --publish     Upload the result (R2 / Origami). Without it, artifacts stay local.
  --all         All targets, including linux-arm64.
`);
    process.exit(1);
}

const HERE = join(import.meta.dir, "..");
const ORIGAMI_URL = process.env.ORIGAMI_URL || "https://origami.ariapis.com";

// Publishing is opt-in: plain builds never touch the network.
const doPublish = process.argv.includes("--publish");

// ─── Auth ─────────────────────────────────────────────────────────────────────

// Credentials come from the environment ONLY. Reading them from
// Origami/.dev.vars was the reason live R2 keys sat on disk in a repo
// about to become a monorepo — secrets never live in files a VCS might
// swallow (AGENTS.md trust model). Set ORIGAMI_AUTH_KEY and the R2_* vars
// in your shell or a secret store.
const authKey = process.env.ORIGAMI_AUTH_KEY ?? "";
if (doPublish && !authKey) {
    console.error("❌ No auth key. Set ORIGAMI_AUTH_KEY in your environment.");
    process.exit(1);
}
if (!doPublish) {
    console.log("   (build-only mode — pass --publish to upload)\n");
}

const appLower = targetArg.toLowerCase();

// ─── R2 (S3 API, multipart-capable) ───────────────────────────────────────────

const r2AccountId =
    process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (doPublish && (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey)) {
    console.error(
        "❌ Missing R2 S3 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your environment.",
    );
    console.error("   Create an API token in Cloudflare → R2 → Manage API Tokens.");
    process.exit(1);
}

// Lazily created: build-only runs never construct it (no creds needed).
let r2: S3Client | null = null;
function getR2(): S3Client {
    if (!r2) {
        r2 = new S3Client({
            accessKeyId: r2AccessKeyId!,
            secretAccessKey: r2SecretAccessKey!,
            bucket: "paperboard-paperdl",
            endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
            partSize: 64 * 1024 * 1024,
        });
    }
    return r2;
}

// ─── Shared build targets ───────────────────────────────────────────────────

type Target =
    | "linux-x64"
    | "linux-arm64"
    | "macos-x64"
    | "macos-arm64"
    | "windows-x64";

// Every shipped target, including linux-arm64 (untested but non-negotiable).
const ALL_TARGETS: Target[] = [
    "linux-x64",
    "linux-arm64",
    "macos-x64",
    "macos-arm64",
    "windows-x64",
];

const BUN_TARGET_MAP: Record<Target, string> = {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "macos-x64": "bun-darwin-x64",
    "macos-arm64": "bun-darwin-arm64",
    "windows-x64": "bun-windows-x64",
};

type Os = "macos" | "windows" | "linux";
const osOf = (t: Target): Os =>
    t.startsWith("macos") ? "macos" : t.startsWith("windows") ? "windows" : "linux";

// Windows metadata for standalone crane binaries. Bun only accepts these
// flags when compiling ON Windows (cross-compiles from other hosts reject
// them), so elsewhere the exe keeps its defaults and icon.ico waits for a
// Windows-host build. Title/publisher/icon live in papercrane/branding/.
function craneCompileFlags(target: Target): string[] {
    if (osOf(target) !== "windows" || process.platform !== "win32") return [];
    const flags = ["--windows-title=PaperCrane", "--windows-publisher=Paperboard"];
    const icon = join(HERE, "papercrane", "branding", "icon.ico");
    if (existsSync(icon)) flags.push(`--windows-icon=${icon}`);
    return flags;
}

const hex = (b: ArrayBuffer) =>
    Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

const version = (JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as { version: string }).version;

// ─── BOARD / PANEL PUBLISHING ─────────────────────────────────────────────────

// USB test bundle: never publishes; assembles installers + crane binaries +
// panels into ../usb/. Dispatched here so all shared declarations above exist.
if (appLower === "usb") {
    await buildUsbFolder();
    process.exit(0);
}

if (appLower !== "pb" && appLower !== "crane" && appLower !== "paperboard") {
    function findBoardDir(name: string): string {
        const candidates = [
            join(HERE, "..", "..", "panels", name),
            join(HERE, "..", "..", "panels", `dev.paperboard.${name}`),
            resolve(name),
        ];
        for (const c of candidates) {
            if (existsSync(join(c, "manifest.json"))) return c;
        }
        throw new Error(
            `Could not find board directory with manifest.json for "${name}". Tried:\n${candidates.join("\n")}`,
        );
    }

    const boardDir = findBoardDir(targetArg);
    const manifestPath = join(boardDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    const { id: boardId, name: boardName, version: boardVersion } =
        resolvePublishTarget(manifest, boardDir);

    console.log(`\n📦 Building Board \x1b[1m${boardName}\x1b[0m (${boardId} v${boardVersion})…\n`);

    // 1. Build panel
    await $`bun run build`.cwd(boardDir);

    // 2. Pack archive into tmp
    const outDir = join(tmpdir(), `paperboard-pack-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    const archiveName = `${boardId}-${boardVersion}.tar.gz`;
    const archivePath = join(outDir, archiveName);

    const entriesToPack = ["manifest.json"];
    if (existsSync(join(boardDir, "dist"))) entriesToPack.push("dist");
    if (existsSync(join(boardDir, "branding"))) entriesToPack.push("branding");
    else if (existsSync(join(boardDir, "icon.png"))) entriesToPack.push("icon.png");

    tar.create(
        {
            gzip: true,
            file: archivePath,
            cwd: boardDir,
            sync: true,
        },
        entriesToPack,
    );

    const archiveBytes = readFileSync(archivePath);
    const sha256Buf = await crypto.subtle.digest("SHA-256", archiveBytes);
    const sha256 = Array.from(new Uint8Array(sha256Buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const mb = (archiveBytes.byteLength / 1024 / 1024).toFixed(2);

    const boardMeta = {
        id: boardId,
        name: boardName,
        version: boardVersion,
        description: manifest.description,
        icon: manifest.icon,
        sha256,
        sizeBytes: archiveBytes.byteLength,
        manifest,
    };

    if (!doPublish) {
        const localOut = join(HERE, "dist", "panels");
        mkdirSync(localOut, { recursive: true });
        const localArchive = join(localOut, archiveName);
        writeFileSync(localArchive, archiveBytes);
        writeFileSync(join(localOut, `${boardId}-${boardVersion}.json`), JSON.stringify(boardMeta, null, 2));
        try { unlinkSync(archivePath); } catch (err) { console.debug("temp archive already gone:", String(err)); }
        console.log(`\n✅ Built (not published) \x1b[1m${boardName}\x1b[0m (${boardId}@${boardVersion}, ${mb} MB)`);
        console.log(`   ${localArchive}\n`);
        process.exit(0);
    }

    console.log(`\n📤 Uploading ${archiveName} (${mb} MB) to Origami…`);

    const formData = new FormData();
    formData.append("archive", new Blob([archiveBytes], { type: "application/gzip" }), archiveName);
    formData.append(
        "metadata",
        JSON.stringify(boardMeta),
    );

    if (manifest.icon) {
        const iconPath = join(boardDir, manifest.icon.replace(/^\.\//, ""));
        if (existsSync(iconPath)) {
            const iconBuffer = readFileSync(iconPath);
            const ext = basename(iconPath).split(".").pop()?.toLowerCase();
            const mimeType = ext === "svg" ? "image/svg+xml" : ext === "webp" ? "image/webp" : "image/png";
            formData.append("icon", new Blob([iconBuffer], { type: mimeType }), basename(iconPath));
        }
    }

    const res = await fetch(`${ORIGAMI_URL}/panel/publish`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authKey}`,
            "X-Auth-Key": authKey,
        },
        body: formData,
    });

    try { unlinkSync(archivePath); } catch (err) { console.debug("temp archive already gone:", String(err)); }

    if (!res.ok) {
        throw new Error(`Publish failed (${res.status} ${res.statusText}): ${await res.text()}`);
    }

    console.log(`\n✅ Successfully published \x1b[1m${boardName}\x1b[0m (${boardId}@${boardVersion})`);
    console.log(`   ${ORIGAMI_URL}/panel/${boardId}/download\n`);
    process.exit(0);
}

// ─── PAPERBOARD & CRANE PUBLISHING ────────────────────────────────────────────

const hostPlatform =
    process.platform === "win32" ? "windows"
    : process.platform === "darwin" ? "macos"
    : "linux";
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
const defaultTarget = `${hostPlatform}-${hostArch}` as Target;

const flagArgs = process.argv.slice(3);
let selectedTargets: Target[] = [];

for (const arg of flagArgs) {
    if (arg === "--all") {
        selectedTargets = [...ALL_TARGETS];
        break;
    }
    const clean = arg.replace(/^--/, "").toLowerCase();
    if (clean === "macos-x64" || clean === "darwin-x64" || clean === "mac-x64") {
        selectedTargets.push("macos-x64");
    } else if (clean === "macos-arm64" || clean === "darwin-arm64" || clean === "mac-arm64") {
        selectedTargets.push("macos-arm64");
    } else if (clean === "windows-x64" || clean === "win-x64") {
        selectedTargets.push("windows-x64");
    } else if (clean === "linux-x64") {
        selectedTargets.push("linux-x64");
    } else if (clean === "linux-arm64") {
        selectedTargets.push("linux-arm64");
    }
}

if (selectedTargets.length === 0) {
    selectedTargets = [defaultTarget];
}

const appName = appLower === "pb" || appLower === "paperboard" ? "paperboard" : "crane";

console.log(`\n🪁 ${doPublish ? "Publishing" : "Building"} ${appName} v${version}`);
console.log(`   Targets: ${selectedTargets.join(", ")}\n`);

const distDir = join(HERE, "dist");
const builtOses = new Set<Os>();
let filePath: string;
const results: {
    target: Target;
    filename: string;
    sha256: string;
    sha512: string;
    sizeBytes: number;
}[] = [];

// Accumulated for the local index.json when building without --publish.
const localIndex: Record<string, unknown> = {};

function loadLocalIndex(indexPath: string): Record<string, unknown> {
    try {
        return JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
        console.debug("no local index yet, starting empty:", String(err));
        return {};
    }
}

function findPaperboardArtifact(target: Target): string {
    const os = osOf(target);
    const exts =
        os === "macos" ? [".zip", ".dmg"] : os === "windows" ? ["-setup.exe"] : [".AppImage"];
    let files = readdirSync(distDir).filter((f) => exts.some((e) => f.endsWith(e)));
    if (!files.length) throw new Error(`No artifact found in ${distDir}`);
    if (os === "macos" || os === "linux") {
        const isArm = target.endsWith("arm64");
        files = files.filter((f) => (isArm ? f.includes("arm64") : !f.includes("arm64")));
        if (!files.length)
            throw new Error(`No ${target} artifact found in ${distDir}. Got: ${readdirSync(distDir).join(", ")}`);
    }
    // Newest first so stale artifacts from earlier builds never win
    files.sort(
        (a, b) =>
            Bun.file(join(distDir, b)).lastModified - Bun.file(join(distDir, a)).lastModified,
    );
    return join(distDir, files[0]);
}

for (const target of selectedTargets) {
    const os = osOf(target);

    console.log(`\n🔨 Building ${appName} v${version} for ${target}…\n`);

    if (appName === "paperboard") {
        // Linux builds one arch per invocation; macOS and Windows cover
        // all their archs in a single build.
        const buildKey = os === "linux" ? target : os;
        if (!builtOses.has(buildKey as Os)) {
            const script =
                os === "macos"
                    ? "build:mac"
                    : os === "windows"
                      ? "build:win"
                      : target.endsWith("arm64")
                        ? "build:linux-arm64"
                        : "build:linux";
            await $`bun run ${script}`.cwd(HERE);
            builtOses.add(buildKey as Os);
        } else {
            console.log(`   (already built for ${buildKey}, reusing artifacts)`);
        }
        filePath = findPaperboardArtifact(target);
    } else {
        const bunTarget = BUN_TARGET_MAP[target];
        const outName = os === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
        await $`bun build --compile --target=${bunTarget} ${craneCompileFlags(target)} ./papercrane/main.ts --outfile ./dist/${outName}`.cwd(HERE);
        filePath = join(distDir, outName);
        if (!existsSync(filePath)) throw new Error(`No crane binary found at ${filePath}`);
    }

    const filename = basename(filePath);
    const mb = (Bun.file(filePath).size / 1024 / 1024).toFixed(1);

    // Hash locally
    process.stdout.write(`   Hashing ${filename} (${mb} MB)… `);
    const bytes = await Bun.file(filePath).arrayBuffer();
    const [sha256, sha512] = await Promise.all([
        crypto.subtle.digest("SHA-256", bytes).then(hex),
        crypto.subtle.digest("SHA-512", bytes).then(hex),
    ]);
    console.log("done");

    // Write metadata index to R2
    const downloadUrl = `https://origami.ariapis.com/paperdl/${appName}/${target}/download`;
    const metadata = { target, version, filename, sha256, sha512, sizeBytes: bytes.byteLength, downloadUrl, publishedAt: new Date().toISOString() };

    if (doPublish) {
        console.log(`\n📤 Uploading ${filename} (${mb} MB) for ${target}…`);
        // Upload binary directly to Cloudflare R2 (S3 API, automatic multipart)
        await getR2().write(`${appName}/${target}`, Bun.file(filePath), {
            type: "application/octet-stream",
        });

        const indexTmp = join(tmpdir(), `paperdl-index-${Date.now()}-${target}.json`);
        try {
            let index: Record<string, unknown> = {};
            try {
                const existing = await fetch(`https://origami.ariapis.com/paperdl/${appName}/index.json`);
                if (existing.ok) index = (await existing.json()) as Record<string, unknown>;
} catch (err) { console.debug("no existing index to merge, starting empty:", String(err)); }
            index[target] = metadata;
            writeFileSync(indexTmp, JSON.stringify(index, null, 2));
            await getR2().write(`${appName}/index.json`, Bun.file(indexTmp), {
                type: "application/json",
            });
        } finally {
            try { unlinkSync(indexTmp); } catch (err) { console.debug("temp index already gone:", String(err)); }
        }

        console.log(`\n✅ ${appName} v${version} (${target}) published`);
        console.log(`   ${downloadUrl}\n`);
    } else {
        localIndex[target] = metadata;
        console.log(`\n✅ ${appName} v${version} (${target}) built (not published)`);
        console.log(`   ${filePath}\n`);
    }

    results.push({ target, filename, sha256, sha512, sizeBytes: bytes.byteLength });
}

// Write electron-updater YAML feeds (paperboard only) — one feed per OS
// covering ALL architectures of that OS, so no feed clobbers another.
// Always written locally; uploaded only with --publish.
if (appName === "paperboard") {
    const byOs = new Map<Os, typeof results>();
    for (const r of results) {
        const os = osOf(r.target);
        if (!byOs.has(os)) byOs.set(os, []);
        byOs.get(os)!.push(r);
    }

    const releaseDate = new Date().toISOString();
    for (const [os, entries] of byOs) {
        const ymlKey = os === "windows" ? "latest.yml" : os === "macos" ? "latest-mac.yml" : "latest-linux.yml";
        const yamlLines = [`version: ${version}`, `files:`];
        for (const e of entries) {
            yamlLines.push(
                `  - url: https://origami.ariapis.com/paperdl/paperboard/${e.target}/download`,
                `    sha512: ${e.sha512}`,
                `    size: ${e.sizeBytes}`,
            );
        }
        const primary = entries[0];
        yamlLines.push(
            `path: https://origami.ariapis.com/paperdl/paperboard/${primary.target}/download`,
            `sha512: ${primary.sha512}`,
            `releaseDate: '${releaseDate}'`,
        );

        const yamlText = yamlLines.join("\n");
        const localYml = join(distDir, ymlKey);
        writeFileSync(localYml, yamlText);
        console.log(`\n📝 Wrote ${ymlKey} (targets: ${entries.map((e) => e.target).join(", ")}) → ${localYml}`);

        if (doPublish) {
            const yamlTmp = join(tmpdir(), `paperdl-${ymlKey}-${Date.now()}.yml`);
            try {
                writeFileSync(yamlTmp, yamlText);
                process.stdout.write(`📤 Uploading ${ymlKey}… `);
                await getR2().write(`paperboard/${ymlKey}`, Bun.file(yamlTmp), {
                    type: "text/yaml",
                });
                console.log("done");
            } finally {
                try { unlinkSync(yamlTmp); } catch (err) { console.debug("temp yaml already gone:", String(err)); }
            }
        }
    }
}

if (!doPublish) {
    // Build-only runs still get a local index for the USB bundle.
    const localIndexPath = join(distDir, `paperdl-${appName}-index.json`);
    writeFileSync(localIndexPath, JSON.stringify({ ...loadLocalIndex(localIndexPath), ...localIndex }, null, 2));
    console.log(`\n📝 Wrote ${appName} index → ${localIndexPath}`);
}

// ─── USB TEST BUNDLE ──────────────────────────────────────────────────────────
// Builds Paperboard installers + crane binaries + all panels into ../usb/:
//
//   usb/
//     installers/    win setup exe, mac zips (x64+arm64), linux AppImage
//     crane/         papercrane-<target> binaries
//     panels/        <board-id>/ (manifest.json + dist/ + branding/)
//     link-panels.sh symlinks panels/ into ~/.paperboard/panels/ for testing
//     README.txt
//
// Never publishes anything. Copy the folder onto a USB stick and test anywhere.
async function buildUsbFolder() {
    const USB = join(HERE, "..", "usb");
    const distDir = join(HERE, "dist");
    const installersDir = join(USB, "installers");
    const craneDir = join(USB, "crane");
    const panelsDir = join(USB, "panels");

    console.log(`\n💾 Building USB test bundle (paperboard v${version}) → ${USB}\n`);
    rmSync(USB, { recursive: true, force: true });
    mkdirSync(installersDir, { recursive: true });
    mkdirSync(craneDir, { recursive: true });
    mkdirSync(panelsDir, { recursive: true });

    // npm ships node-pty's spawn-helper without the exec bit; restore it or
    // every packaged mac app gets a pty helper that can never execute.
    // (Runtime self-heal in pty.ts covers copies; this covers the build.)
    for (const arch of ["x64", "arm64"]) {
        const helper = join(
            HERE,
            "node_modules",
            "node-pty",
            "prebuilds",
            `darwin-${arch}`,
            "spawn-helper",
        );
        try {
            if (existsSync(helper)) await $`chmod +x ${helper}`;
        } catch (err) { console.debug("spawn-helper chmod skipped:", String(err)); }
    }

    const snapshotDist = () => Date.now();
    const copyNew = (buildStart: number, dest: string, match: (f: string) => boolean) => {
        // Rebuilds overwrite the same filename, so freshness is by mtime.
        const fresh = readdirSync(distDir).filter((f) => {
            if (!match(f)) return false;
            try {
                return statSync(join(distDir, f)).mtimeMs >= buildStart - 5000;
            } catch (err) {
                console.debug("stat raced deletion, skipping:", String(err));
                return false;
            }
        });
        for (const f of fresh) cpSync(join(distDir, f), join(dest, f));
        return fresh;
    };

    // 1. Paperboard installers per OS (win + linux direct; mac via tarball below)
    const osBuilds: { os: Os; script: string; match: (f: string) => boolean }[] = [
        { os: "windows", script: "build:win", match: (f) => f.endsWith("-setup.exe") },
        { os: "linux", script: "build:linux", match: (f) => f.endsWith(".AppImage") },
        { os: "linux", script: "build:linux-arm64", match: (f) => f.endsWith(".AppImage") },
    ];
    const installerFiles: string[] = [];
    for (const { os, script, match } of osBuilds) {
        console.log(`\n🔨 Building Paperboard for ${os}…\n`);
        const before = snapshotDist();
        await $`bun run ${script}`.cwd(HERE);
        const fresh = copyNew(before, installersDir, match);
        if (!fresh.length) throw new Error(`No fresh installer found in ${distDir} after ${script}`);
        installerFiles.push(...fresh.map((f) => `installers/${f}`));
        console.log(`   → ${fresh.join(", ")}`);
    }

    // macOS ships as tarballs, not zips: tar preserves unix modes and the
    // Frameworks symlinks inside the .app, and a single file survives
    // FAT32 USB sticks — users double-click and drag to Applications, no
    // chmod, no DMG tooling needed (hdiutil is macOS-only). The zip stays
    // in dist/ for the updater feed.
    {
        console.log(`\n🔨 Building Paperboard for macos…\n`);
        await $`bun run build:mac`.cwd(HERE);
        const macApps: { dir: string; arch: string }[] = [
            { dir: join(distDir, "mac"), arch: "x64" },
            { dir: join(distDir, "mac-arm64"), arch: "arm64" },
        ];
        for (const { dir, arch } of macApps) {
            const appPath = join(dir, "Paperboard.app");
            if (!existsSync(appPath)) throw new Error(`No app bundle at ${appPath}`);
            const tarName = `paperboard-${version}-macos-${arch}.tar.gz`;
            await $`tar czf ${join(installersDir, tarName)} -C ${dir} Paperboard.app`.cwd(HERE);
            installerFiles.push(`installers/${tarName}`);
            console.log(`   → ${tarName}`);
        }
    }

    // 2. Crane binaries (all targets except linux-arm64 — no testing surface)
    const craneFiles: string[] = [];
    for (const target of ALL_TARGETS) {
        const os = osOf(target);
        const bunTarget = BUN_TARGET_MAP[target];
        const outName = os === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
        console.log(`\n🔨 Building crane for ${target}…`);
        await $`bun build --compile --target=${bunTarget} ${craneCompileFlags(target)} ./papercrane/main.ts --outfile ./dist/${outName}`.cwd(HERE);
        const built = join(distDir, outName);
        if (!existsSync(built)) throw new Error(`No crane binary found at ${built}`);
        cpSync(built, join(craneDir, outName));
        craneFiles.push(`crane/${outName}`);
    }

    // node-pty sidecar for standalone Windows: lets the compiled binary
    // reach conpty (absolute require resolves internally) instead of the
    // pipe fallback. macOS/Linux standalone use the Bun FFI backend.
    {
        const sidecarSrc = join(HERE, "node_modules", "node-pty");
        const sidecarDest = join(craneDir, "node-pty");
        mkdirSync(join(sidecarDest, "lib"), { recursive: true });
        mkdirSync(join(sidecarDest, "prebuilds", "win32-x64"), { recursive: true });
        cpSync(join(sidecarSrc, "lib"), join(sidecarDest, "lib"), { recursive: true });
        // Sidecar patch: Bun's net.Socket({fd}) silently drops writes to
        // conpty input pipes; plain fs writes deliver. Scoped to this copy
        // (standalone crane only — Electron resolves its own node-pty).
        {
            const agentJs = join(sidecarDest, "lib", "windowsPtyAgent.js");
            const src = readFileSync(agentJs, "utf8");
            const from = `        var inSocketFD = fs.openSync(term.conin, 'w');
        this._inSocket = new net_1.Socket({
            fd: inSocketFD,
            readable: false,
            writable: true
        });
        this._inSocket.setEncoding('utf8');`;
            const to = `        var inSocketFD = fs.openSync(term.conin, 'w');
        // Paperboard sidecar patch: Bun's net.Socket({fd}) silently drops
        // writes to conpty input pipes (or throws ERR_SOCKET_CLOSED), while
        // plain fs writes deliver. This copy ships ONLY with the standalone
        // crane (always the Bun runtime); Electron resolves its own
        // node-pty and never loads this file.
        var inSocketShim = {
            _fd: inSocketFD,
            readable: false,
            writable: true,
            setEncoding: function () {},
            destroy: function () { try { fs.closeSync(inSocketFD); } catch (e) { console.debug("shim socket already closed:", String(e)); } },
            on: function () { return this; },
            once: function () { return this; },
            removeListener: function () { return this; },
            write: function (data, a, b) {
                try {
                    var buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
                    fs.writeSync(inSocketFD, buf, 0, buf.length);
                    if (typeof a === "function") a();
                    return true;
                } catch (e) {
                    if (typeof console !== "undefined" && console.debug) console.debug("shim socket write failed");
                    if (typeof a === "function") a(e);
                    return false;
                }
            }
        };
        this._inSocket = inSocketShim;`;
            if (!src.includes(from)) {
                throw new Error("node-pty sidecar patch no longer applies — update it for the new node-pty version");
            }
            writeFileSync(agentJs, src.replace(from, to));
        }
        cpSync(
            join(sidecarSrc, "prebuilds", "win32-x64"),
            join(sidecarDest, "prebuilds", "win32-x64"),
            { recursive: true },
        );
        // Debug symbols are dead weight at runtime (~25MB).
        for (const dead of readdirSync(join(sidecarDest, "prebuilds", "win32-x64"), { recursive: true }) as string[]) {
            if (dead.endsWith(".pdb") || dead.endsWith(".map")) {
                unlinkSync(join(sidecarDest, "prebuilds", "win32-x64", dead));
            }
        }
        console.log(`   → node-pty sidecar (win32-x64)`);
    }

    // 3. All panels (workspace dirs carrying a manifest.json)
    const panelEntries: { id: string; name: string; version: string }[] = [];
    const siblings = readdirSync(join(HERE, ".."), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(HERE, "..", e.name))
        .filter((d) => existsSync(join(d, "manifest.json")));
    for (const boardDir of siblings) {
        const manifest = JSON.parse(readFileSync(join(boardDir, "manifest.json"), "utf8"));
        const boardId = manifest.id || basename(boardDir);
        console.log(`\n📦 Building panel ${boardId}…\n`);
        await $`bun run build`.cwd(boardDir);
        const dest = join(panelsDir, boardId);
        mkdirSync(dest, { recursive: true });
        cpSync(join(boardDir, "manifest.json"), join(dest, "manifest.json"));
        if (existsSync(join(boardDir, "dist"))) cpSync(join(boardDir, "dist"), join(dest, "dist"), { recursive: true });
        if (existsSync(join(boardDir, "branding"))) {
            cpSync(join(boardDir, "branding"), join(dest, "branding"), { recursive: true });
        } else if (existsSync(join(boardDir, "icon.png"))) {
            cpSync(join(boardDir, "icon.png"), join(dest, "icon.png"));
        }
        panelEntries.push({ id: boardId, name: manifest.name || boardId, version: manifest.version || "?" });
    }

    // 4. Symlink helper: links every bundled panel into ~/.paperboard/panels/
    // (the crane serves symlinked panels as-is and refuses to overwrite them
    // on install, so they behave as dev-linked panels for testing).
    const linkScript = `#!/bin/sh
# Links every panel in this USB bundle into ~/.paperboard/panels/ for testing.
# Usage: ./link-panels.sh
set -eu
SRC="$(cd "$(dirname "$0")/panels" && pwd)"
DEST="\${PAPERBOARD_DIR:-\$HOME/.paperboard}/panels"
mkdir -p "$DEST"
for d in "$SRC"/*/; do
    id="$(basename "$d")"
    ln -sfn "$SRC/$id" "$DEST/$id"
    echo "linked $id -> $DEST/$id"
done
echo "done. Restart Paperboard to pick up the panels."
`;
    const linkPath = join(USB, "link-panels.sh");
    writeFileSync(linkPath, linkScript);
    await $`chmod +x ${linkPath}`;

    // Windows twin: directory junctions need no admin rights (unlike
    // symlinks). Double-click to run.
    const linkBat = `@echo off
REM Links every panel in this USB bundle into %USERPROFILE%\\.paperboard\\panels\\ for testing.
REM Usage: double-click link-panels.bat
setlocal
set "SRC=%~dp0panels"
if "%PAPERBOARD_DIR%"=="" (set "DEST=%USERPROFILE%\\.paperboard\\panels") else (set "DEST=%PAPERBOARD_DIR%\\panels")
if not exist "%DEST%" mkdir "%DEST%"
for /d %%d in ("%SRC%\\*") do (
    if exist "%DEST%\\%%~nxd" rmdir "%DEST%\\%%~nxd" 2>nul
    mklink /J "%DEST%\\%%~nxd" "%%d" >nul 2>&1
    if errorlevel 1 (
        echo FAILED: %%~nxd ^(enable Developer Mode or run as admin^)
    ) else (
        echo linked %%~nxd
    )
)
echo done. Restart Paperboard to pick up the panels.
`;
    writeFileSync(join(USB, "link-panels.bat"), linkBat);

    const readme = `Paperboard v${version} — USB test bundle (built ${new Date().toISOString()})

INSTALLERS (installers/)
${installerFiles.map((f) => `  ${f}`).join("\n")}

  Install: Windows -> run the setup exe; macOS -> double-click the
  .tar.gz to extract, then drag Paperboard.app to Applications (the tarball
  preserves permissions — never copy the .app itself off the stick);
  Linux -> chmod +x the .AppImage, then run it.

  CRANE DAEMON BINARIES (crane/)
  Standalone papercrane daemon per target. Mostly useful for headless boxes:
    ./papercrane-linux-x64 --help
  Plus node-pty/ — helper files the Windows binary needs for real terminal
  emulation (keep the folder next to the .exe).
${craneFiles.map((f) => `  ${f}`).join("\n")}

PANELS (panels/)
${panelEntries.map((p) => `  ${p.id} (${p.name} v${p.version})`).join("\n")}

  Panels are prebuilt (dist/ included). To test them:
    1. Copy this folder anywhere, e.g. ~/paperboard-usb
    2. USB sticks strip executable bits — restore them first:
         macOS/Linux: chmod +x crane/* link-panels.sh
         (Windows .exe files are unaffected.)
    3. ./link-panels.sh  (macOS/Linux) or double-click link-panels.bat (Windows)
       (symlinks/junctions each panel into ~/.paperboard/panels/)
    4. (Re)start Paperboard — linked panels load as-is

  Set PAPERBOARD_DIR=... before running the script to target a custom data dir.
  The crane never overwrites a symlinked panel on registry install.

  LAN PAIRING / WINDOWS FIREWALL
  Remote devices reach the crane over HTTP/WS on its port (default 45464).
  On Windows, accept the Firewall first-listen prompt for the crane/app binary.
  If remote pairing times out while localhost works, the prompt was declined
  or the binary moved: add an inbound exception manually (Windows Defender
  Firewall > Allow an app through firewall > papercrane). macOS/Linux need
  nothing (no default firewall blocks).
`;
    writeFileSync(join(USB, "README.txt"), readme);

    console.log(`\n✅ USB bundle ready → ${USB}`);
    console.log(`   ${installerFiles.length} installer(s), ${craneFiles.length} crane binarie(s), ${panelEntries.length} panel(s)`);
    console.log(`   Copy the folder onto a USB stick and run ./link-panels.sh on the test machine.\n`);
}




