#!/usr/bin/env bun
/**
 * publish.ts: interactive build & publish console for Paperboard.
 *
 *   bun scripts/publish.ts        # interactive menu (needs a TTY)
 *   bun scripts/publish.ts usb    # headless USB test bundle (bun run usb)
 *
 * Nothing leaves the machine except through the Publish flows, and each of
 * those confirms twice before any upload. Pure release-math (tags, asset
 * names, URLs, latest.yml, KV merges) lives in publishLib.ts, tested in
 * publishLib.test.ts — this file is the interactive shell around it.
 *
 * Auth is per-run and never stored:
 *   Cloudflare (KV + R2) … wrangler login session (wrangler whoami/login)
 *   GitHub (releases) …… gh auth login session (gh auth status/login)
 *   Origami panels ……… prompt once per run, never written to disk
 * There are no key files. .dev.vars / R2_* env keys are gone on purpose.
 */

import * as p from "@clack/prompts";
import { Presets, SingleBar } from "cli-progress";
import { $ } from "bun";
import AdmZip from "adm-zip";
import {
    readFileSync,
    existsSync,
    readdirSync,
    writeFileSync,
    unlinkSync,
    mkdirSync,
    rmSync,
    cpSync,
    statSync,
    chmodSync,
} from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import * as tar from "tar";
import { writeNodePtySidecar } from "./craneSidecar";
import { discoverPanels, PANELS_ROOT } from "./publishManifest";
import {
    ALL_TARGETS,
    archOf,
    BUN_TARGET_MAP,
    DL_HOST,
    GH_REPO,
    KV_PACKAGES_BINDING,
    PAPERDL_R2_BUCKET,
    assetFileName,
    paperboardArtifacts,
    buildCraneIndex,
    buildLatestYml,
    dlFileUrl,
    isValidVersionSegment,
    kvKeyFor,
    mergeVersionRecord,
    osOf,
    ORIGAMI_HOST,
    parseUsbArgs,
    storeUploadParts,
    tagFor,
    targetsForOses,
    USB_ARCHES,
    USB_OSES,
    ymlKeyFor,
    type Arch,
    type DlApp,
    type DlAppRecord,
    type Os,
    type Target,
    type VersionFileEntry,
    type YmlEntry,
} from "./publishLib";
import { applyWindowsIcon } from "./windowsIcon";
import { loadReleaseSigningKey, releaseMessage, signRelease } from "./releaseSigning";
import { RELEASE_PUBLIC_KEY, verifyRelease } from "../apps/paperboard/papercrane/releaseSignature";
import {
    createWranglerStorage,
    publishPanel,
    type PanelUpload,
} from "../apps/origami/scripts/lib/panelPublish";
import type { KeyObject } from "node:crypto";

// signs one release fact and proves the signature verifies against the
// public key clients ship with, before anything uploads
function signVerified(key: KeyObject, msg: Buffer, what: string): string {
    const signature = signRelease(key, msg);
    if (!verifyRelease(msg, signature, RELEASE_PUBLIC_KEY)) {
        fail(`The release key does not match RELEASE_PUBLIC_KEY in papercrane/releaseSignature.ts; refusing to publish ${what}.`);
    }
    return signature;
}

const HERE = join(import.meta.dir, "..", "apps", "paperboard");
const ORIGAMI_DIR = join(HERE, "..", "origami");
const ORIGAMI_URL = process.env.ORIGAMI_URL || "https://origami.ariapis.com";

const version = (
    JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as {
        version: string;
    }
).version;

// ─── Small helpers ──────────────────────────────────────────────────────────

function cancelled(): never {
    p.cancel("Cancelled — nothing was uploaded.");
    process.exit(0);
}

function checkCancel<T>(v: T | symbol): T {
    if (p.isCancel(v)) cancelled();
    return v as T;
}

function fail(msg: string): never {
    p.cancel(msg);
    process.exit(1);
}

const hex = (b: ArrayBuffer) =>
    Array.from(new Uint8Array(b))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// Run a command. Loud (inherited stdio) for long builds so their own
// progress shows; quiet (captured) for plumbing where only the exit code
// and output matter. argv arrays only — never a shell string.
async function sh(
    cmd: string[],
    opts: { cwd?: string; quiet?: boolean } = {},
): Promise<string> {
    const quiet = opts.quiet ?? false;
    const proc = Bun.spawn(cmd, {
        cwd: opts.cwd ?? HERE,
        stdout: quiet ? "pipe" : "inherit",
        stderr: quiet ? "pipe" : "inherit",
    });
    const out = quiet && proc.stdout ? await new Response(proc.stdout).text() : "";
    const errText =
        quiet && proc.stderr ? await new Response(proc.stderr).text() : "";
    const code = await proc.exited;
    if (code !== 0) {
        throw new Error(
            `\`${cmd.join(" ")}\` exited ${code}${errText.trim() ? `\n${errText.trim()}` : ""}`,
        );
    }
    return out.trim();
}

async function cmdOk(cmd: string[], cwd?: string): Promise<boolean> {
    try {
        const code = await Bun.spawn(cmd, {
            cwd: cwd ?? HERE,
            stdout: "ignore",
            stderr: "ignore",
        }).exited;
        return code === 0;
    } catch (err) {
        // Spawn itself failed (binary missing, not a non-zero exit):
        // false is the honest answer, and the trace stays in the log.
        console.debug(`probe ${cmd[0]} unavailable:`, String(err));
        return false;
    }
}

async function hashFile(
    path: string,
): Promise<{ sha256: string; sha512: string; size: number }> {
    const bytes = await Bun.file(path).arrayBuffer();
    const [sha256, sha512] = await Promise.all([
        crypto.subtle.digest("SHA-256", bytes).then(hex),
        crypto.subtle.digest("SHA-512", bytes).then(hex),
    ]);
    return { sha256, sha512, size: bytes.byteLength };
}

function printTable(rows: string[][]): void {
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    for (const r of rows) {
        console.log(
            `  ${r.map((c, i) => c.padEnd(widths[i])).join("   ")}`,
        );
    }
}

function bar(total: number): SingleBar {
    const b = new SingleBar(
        { format: "  {bar} {percentage}% | {value}/{total} | {task}" },
        Presets.shades_classic,
    );
    b.start(total, 0, { task: "" });
    return b;
}

// ─── Auth (per-run sessions, nothing stored) ────────────────────────────────

let wranglerBin: string[] | null = null;

async function wrBin(): Promise<string[]> {
    if (!wranglerBin) {
        if (await cmdOk(["wrangler", "--version"])) {
            wranglerBin = ["wrangler"];
        } else {
            p.log.warn(
                "wrangler is not on PATH — running it via `bun x wrangler` (downloads on first use).",
            );
            wranglerBin = [process.execPath, "x", "wrangler"];
        }
    }
    return wranglerBin;
}

async function wr(args: string[]): Promise<string> {
    return sh([...(await wrBin()), ...args], { cwd: ORIGAMI_DIR, quiet: true });
}

async function ensureCloudflareAuth(): Promise<void> {
    const bin = await wrBin();
    if (await cmdOk([...bin, "whoami"], ORIGAMI_DIR)) {
        p.log.success("Cloudflare: already logged in.");
        return;
    }
    p.log.warn("Cloudflare: not logged in — opening `wrangler login`…");
    await sh([...bin, "login"], { cwd: ORIGAMI_DIR, quiet: false });
    if (!(await cmdOk([...bin, "whoami"], ORIGAMI_DIR))) {
        fail("Cloudflare login did not complete. Aborting before anything uploads.");
    }
    p.log.success("Cloudflare: logged in.");
}

async function ensureGithubAuth(): Promise<void> {
    if (!(await cmdOk(["gh", "--version"]))) {
        fail("GitHub CLI (gh) not found. Install it from https://cli.github.com, then re-run.");
    }
    if (await cmdOk(["gh", "auth", "status"])) {
        p.log.success("GitHub: already authenticated.");
        return;
    }
    p.log.warn("GitHub: not authenticated — opening `gh auth login`…");
    await sh(["gh", "auth", "login"], { quiet: false });
    if (!(await cmdOk(["gh", "auth", "status"]))) {
        fail("GitHub login did not complete. Aborting before anything uploads.");
    }
    p.log.success("GitHub: authenticated.");
}

// ─── Cloudflare state (KV version DB + R2 metadata) ─────────────────────────

async function kvReadRecord(app: DlApp): Promise<DlAppRecord | null> {
    // List-then-get: a missing key is a legitimate "no record yet", but an
    // unreadable record must never be silently treated as empty and
    // overwritten (that would drop every previous version).
    const key = kvKeyFor(app);
    let listed: { name: string }[];
    try {
        listed = JSON.parse(
            await wr([
                "kv",
                "key",
                "list",
                "--binding",
                KV_PACKAGES_BINDING,
                "--prefix",
                key,
                "--remote",
            ]),
        );
    } catch (err) {
        throw new Error(
            `Could not list KV keys: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!listed.some((k) => k.name === key)) return null;
    const raw = await wr([
        "kv",
        "key",
        "get",
        "--binding",
        KV_PACKAGES_BINDING,
        key,
        "--remote",
    ]);
    let rec: unknown;
    try {
        rec = JSON.parse(raw);
    } catch {
        fail(
            `KV record ${key} exists but is not valid JSON. Refusing to overwrite it — inspect it with \`wrangler kv key get --binding ${KV_PACKAGES_BINDING} "${key}" --remote\` first.`,
        );
    }
    if (
        typeof rec !== "object" ||
        rec === null ||
        typeof (rec as DlAppRecord).latest !== "string" ||
        typeof (rec as DlAppRecord).versions !== "object"
    ) {
        fail(`KV record ${key} has an unexpected shape. Refusing to overwrite it.`);
    }
    return rec as DlAppRecord;
}

async function kvWriteRecord(app: DlApp, rec: DlAppRecord): Promise<void> {
    // --remote is load-bearing: without it wrangler writes to local
    // miniflare state and the publish "succeeds" while production stays
    // empty (the index then never reaches i.paperboard.dev).
    await wr([
        "kv",
        "key",
        "put",
        "--binding",
        KV_PACKAGES_BINDING,
        kvKeyFor(app),
        JSON.stringify(rec),
        "--remote",
    ]);
}

async function r2Put(key: string, filePath: string, contentType: string): Promise<void> {
    await wr([
        "r2",
        "object",
        "put",
        `${PAPERDL_R2_BUCKET}/${key}`,
        "--file",
        filePath,
        "--content-type",
        contentType,
        "--remote",
    ]);
}

// ─── GitHub releases ────────────────────────────────────────────────────────

async function ghReleaseEnsure(tag: string, title: string): Promise<void> {
    if (await cmdOk(["gh", "release", "view", tag, "--repo", GH_REPO])) {
        p.log.info(`Release ${tag} already exists — uploading assets into it.`);
        return;
    }
    await sh([
        "gh",
        "release",
        "create",
        tag,
        "--repo",
        GH_REPO,
        "--title",
        title,
        "--notes",
        `${title} (${new Date().toISOString().slice(0, 10)})`,
    ]);
}

// ─── Builds ─────────────────────────────────────────────────────────────────

const PB_BUILD_SCRIPT: Record<Target, string> = {
    "linux-x64": "build:linux",
    "linux-arm64": "build:linux-arm64",
    "macos-x64": "build:mac-x64",
    "macos-arm64": "build:mac-arm64",
    "windows-x64": "build:win",
};

const distDir = join(HERE, "dist");

// Windows version-info metadata for standalone crane binaries. Bun only
// accepts these flags when compiling ON Windows (cross-compiles from other
// hosts reject them), so elsewhere the exe keeps default version info. The
// icon is NOT set here: Bun also refuses `--windows-icon` in a cross-compile,
// so it is applied to every build by applyCraneWindowsIcon below, from
// papercrane/branding/icon.ico.
function craneCompileFlags(target: Target): string[] {
    if (osOf(target) !== "windows" || process.platform !== "win32") return [];
    return ["--windows-title=Paperboard Server", "--windows-publisher=Paperboard"];
}

// Stamp the Crane icon onto a freshly built Windows crane binary. Runs on
// every host so a Linux/macOS cross-build no longer ships Bun's default logo.
function applyCraneWindowsIcon(filePath: string): void {
    const icon = join(HERE, "papercrane", "branding", "icon.ico");
    if (existsSync(icon)) applyWindowsIcon(filePath, icon);
}

// npm ships node-pty's spawn-helper without the exec bit and electron-builder
// copies it verbatim, so an unsigned macOS .app packaged on any host (Linux
// CI included) would get a pty helper that can never execute. Restore the bit
// in-place before packaging; a missing helper is left as-is (node-pty may not
// ship every arch).
function ensureMacSpawnHelpers(): void {
    for (const arch of ["x64", "arm64"]) {
        const helper = join(HERE, "node_modules", "node-pty", "prebuilds", `darwin-${arch}`, "spawn-helper");
        if (existsSync(helper)) chmodSync(helper, 0o755);
    }
}

interface BuiltBinary {
    app: DlApp;
    target: Target;
    filePath: string;
    filename: string;
    sha256: string;
    sha512: string;
    size: number;
}

async function buildPbTarget(target: Target): Promise<BuiltBinary> {
    if (osOf(target) === "macos") ensureMacSpawnHelpers();
    await sh([process.execPath, "run", PB_BUILD_SCRIPT[target]], { quiet: false });
    const artifact = paperboardArtifacts(target, version);
    const filePath = join(distDir, artifact.buildFile);
    if (!existsSync(filePath)) throw new Error(`Missing ${target} artifact: ${filePath}`);
    const { sha256, sha512, size } = await hashFile(filePath);
    return { app: "pb", target, filePath, filename: artifact.buildFile, sha256, sha512, size };
}

async function buildCraneTarget(target: Target): Promise<BuiltBinary> {
    const bunTarget = BUN_TARGET_MAP[target];
    const outName =
        osOf(target) === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
    await sh(
        [
            process.execPath,
            "build",
            "--compile",
            `--target=${bunTarget}`,
            ...craneCompileFlags(target),
            "./papercrane/main.ts",
            "--outfile",
            `./dist/${outName}`,
        ],
        { quiet: false },
    );
    const filePath = join(distDir, outName);
    if (!existsSync(filePath))
        throw new Error(`No Paperboard Server binary found at ${filePath}`);
    if (osOf(target) === "windows") applyCraneWindowsIcon(filePath);
    const { sha256, sha512, size } = await hashFile(filePath);
    return { app: "crane", target, filePath, filename: basename(filePath), sha256, sha512, size };
}

// Stage release assets under dist/release/: pb artifacts copied to their
// canonical versionless names, crane binaries packed (tar.gz on posix to
// preserve the exec bit, zip on Windows) and hashed as shipped.
async function stageReleaseAssets(built: BuiltBinary[]): Promise<BuiltBinary[]> {
    const stagedDir = join(distDir, "release");
    rmSync(stagedDir, { recursive: true, force: true });
    mkdirSync(stagedDir, { recursive: true });
    const staged: BuiltBinary[] = [];
    for (const b of built) {
        const file = b.app === "pb"
            ? paperboardArtifacts(b.target, version).releaseFile
            : assetFileName(b.app, b.target);
        const outPath = join(stagedDir, file);
        if (b.app === "pb") {
            cpSync(b.filePath, outPath);
        } else {
            // tar preserves the mode the extractor needs; make it explicit
            // first so the archive never ships a non-executable binary.
            chmodSync(b.filePath, 0o755);
            if (osOf(b.target) === "windows") {
                const zip = new AdmZip();
                zip.addFile(b.filename, readFileSync(b.filePath));
                const sidecarDir = join(distDir, "release-sidecar");
                rmSync(sidecarDir, { recursive: true, force: true });
                writeNodePtySidecar(sidecarDir, join(HERE, "node_modules", "node-pty"));
                zip.addLocalFolder(join(sidecarDir, "node-pty"), "node-pty");
                rmSync(sidecarDir, { recursive: true, force: true });
                zip.writeZip(outPath);
            } else {
                tar.create(
                    { gzip: true, file: outPath, cwd: distDir, sync: true },
                    [b.filename],
                );
            }
        }
        const { sha256, sha512, size } = await hashFile(outPath);
        staged.push({ ...b, filePath: outPath, filename: file, sha256, sha512, size });
    }
    return staged;
}

// Build the selected app/target jobs, each hashed as produced. Shared by the
// interactive build flow and the headless CI builder; the CI builder then
// stages the canonical release assets with stageReleaseAssets.
async function buildSelected(jobs: { app: DlApp; target: Target }[]): Promise<BuiltBinary[]> {
    const progress = bar(jobs.length);
    const built: BuiltBinary[] = [];
    for (const j of jobs) {
        const b =
            j.app === "pb" ? [await buildPbTarget(j.target)] : [await buildCraneTarget(j.target)];
        built.push(...b);
        progress.increment(1, { task: `${j.app} ${j.target}` });
    }
    progress.stop();
    return built;
}

// ─── Flow: build binaries (local only) ──────────────────────────────────────

async function flowBuildBinaries(): Promise<void> {
    p.intro(`Build binaries (v${version}, local only — nothing uploads)`);
    const picked = checkCancel(
        await p.multiselect({
            message: "Which binaries to build?",
            options: [
                ...ALL_TARGETS.map((t) => ({
                    value: `pb:${t}`,
                    label: `Paperboard · ${t}`,
                    hint: `v${version}`,
                })),
                ...ALL_TARGETS.map((t) => ({
                    value: `crane:${t}`,
                    label: `Paperboard Server · ${t}`,
                    hint: `v${version}`,
                })),
            ],
            required: true,
        }),
    );

    const jobs = (picked as string[]).map((v) => {
        const [app, target] = v.split(":") as [DlApp, Target];
        return { app, target };
    });

    const built = await buildSelected(jobs);

    // Local record (informational; the USB bundle rebuilds from scratch).
    for (const app of ["pb", "crane"] as DlApp[]) {
        const mine = built.filter((b) => b.app === app);
        if (!mine.length) continue;
        const record: Record<string, unknown> = {};
        for (const b of mine) {
            record[b.target] = {
                file: b.filename,
                path: b.filePath,
                sha256: b.sha256,
                sha512: b.sha512,
                size: b.size,
            };
        }
        writeFileSync(
            join(distDir, `build-${app}-${version}.json`),
            JSON.stringify({ version, builtAt: new Date().toISOString(), targets: record }, null, 2),
        );
    }

    p.log.success(`Built ${built.length} binary(ies):`);
    printTable([
        ["app", "target", "size", "sha256"],
        ...built.map((b) => [b.app, b.target, `${mb(b.size)} MB`, b.sha256.slice(0, 16)]),
    ]);
    p.outro("Done — artifacts are in dist/.");
}

// ─── Flow: publish binaries (GitHub Releases + live index) ──────────────────

async function flowPublishBinaries(): Promise<void> {
    p.intro("Publish binaries");
    if (!isValidVersionSegment(version)) {
        fail(
            `Refusing to publish version ${JSON.stringify(version)}: it is not a safe URL/tag segment. Fix package.json first.`,
        );
    }
    p.log.info(`Paperboard v${version} + Paperboard Server v${version}`);
    p.log.warn("Publishing is a big step: GitHub Releases are created and the live download index moves.");
    if (!checkCancel(await p.confirm({ message: `Build all 10 binaries for v${version}?`, initialValue: false }))) {
        cancelled();
    }
    // daemons refuse unsigned self-updates: no key, nothing is built
    const signingKey = loadReleaseSigningKey();

    const jobs: { app: DlApp; target: Target }[] = [
        ...ALL_TARGETS.map((target) => ({ app: "pb" as DlApp, target })),
        ...ALL_TARGETS.map((target) => ({ app: "crane" as DlApp, target })),
    ];
    const built = await buildSelected(jobs);

    p.log.step("Staging canonical release assets in dist/release/…");
    const staged = await stageReleaseAssets(built);

    p.log.info("Built and hashed as-shipped:");
    printTable([
        ["file", "size", "sha256"],
        ...staged.map((b) => [b.filename, `${mb(b.size)} MB`, b.sha256.slice(0, 16)]),
    ]);
    if (
        !checkCancel(
            await p.confirm({
                message: `Upload ${staged.length} files and move the live "latest" pointer to v${version}?`,
                initialValue: false,
            }),
        )
    ) {
        cancelled();
    }

    await ensureGithubAuth();
    await ensureCloudflareAuth();

    // One GitHub release per version (tag v<version>) holding every app and
    // server binary: the app embeds its daemon, so they ship as one artifact
    // set under one tag.
    const tag = tagFor(version);
    await ghReleaseEnsure(tag, `Paperboard v${version}`);
    const up = bar(staged.length);
    for (const b of staged) {
        await sh(["gh", "release", "upload", tag, b.filePath, "--clobber", "--repo", GH_REPO], {
            quiet: true,
        });
        up.increment(1, { task: b.filename });
    }
    up.stop();
    p.log.success(`${tag}: ${staged.length} asset(s) uploaded.`);

    await publishIndex(signingKey, version, staged);

    p.log.success("Published:");
    printTable([
        ["what", "url"],
        [`release`, `https://github.com/${GH_REPO}/releases/tag/${tagFor(version)}`],
        [`latest pb`, dlFileUrl("pb", "latest", assetFileName("pb", "macos-arm64"))],
        [`latest crane`, dlFileUrl("crane", "latest", assetFileName("crane", "linux-x64"))],
    ]);
    p.outro(`Paperboard v${version} is live.`);
}

// Move the live index to a finished release: KV version records, the signed
// crane update index on R2, and the electron-updater feeds.
async function publishIndex(signingKey: KeyObject, v: string, staged: BuiltBinary[]): Promise<void> {
    for (const app of ["pb", "crane"] as DlApp[]) {
        const prev = await kvReadRecord(app);
        const files: VersionFileEntry[] = staged
            .filter((b) => b.app === app)
            .map((b) => ({
                file: b.filename,
                sha256: b.sha256,
                sha512: b.sha512,
                size: b.size,
                signature: app === "crane"
                    ? signVerified(signingKey, releaseMessage.crane(v, b.sha256), b.filename)
                    : signVerified(signingKey, releaseMessage.app(v, b.filename, b.sha512), b.filename),
            }));
        const next = mergeVersionRecord(prev, v, files);
        await kvWriteRecord(app, next);
        p.log.success(
            `Index ${kvKeyFor(app)}: recorded v${v} (${prev ? Object.keys(prev.versions).length : 0} → ${Object.keys(next.versions).length} versions, latest → v${v}).`,
        );
    }

    // The host's crane update planner reads this R2 projection, not KV. It
    // carries the signed version/sha256 facts the daemon verifies, so a
    // remote self-update has an authoritative entry to act on.
    const craneIndex = buildCraneIndex(
        v,
        staged
            .filter((b) => b.app === "crane")
            .map((b) => ({
                target: b.target,
                file: b.filename,
                sha256: b.sha256,
                signature: signVerified(signingKey, releaseMessage.crane(v, b.sha256), b.filename),
            })),
    );
    const craneIndexTmp = join(tmpdir(), `crane-index-${Date.now()}.json`);
    try {
        writeFileSync(craneIndexTmp, JSON.stringify(craneIndex, null, 2));
        await r2Put("crane/index.json", craneIndexTmp, "application/json");
        p.log.success(
            `Index paperdl/crane/index.json: signed entries for ${Object.keys(craneIndex).length} targets.`,
        );
    } finally {
        try {
            unlinkSync(craneIndexTmp);
        } catch (err) {
            console.debug("temp crane index already gone:", String(err));
        }
    }

    // electron-updater feeds (paperboard only) stay on Origami/R2; their
    // file URLs point at the dl "latest" alias, which 302s to GitHub.
    const releaseDate = new Date().toISOString();
    const byOs = new Map<Os, YmlEntry[]>();
    for (const b of staged) {
        if (b.app !== "pb") continue;
        const os = osOf(b.target);
        if (!byOs.has(os)) byOs.set(os, []);
        byOs.get(os)!.push({ target: b.target, file: b.filename, sha512: b.sha512, size: b.size });
    }
    for (const [os, entries] of byOs) {
        const { key, text } = buildLatestYml(os, v, entries, releaseDate);
        const tmp = join(tmpdir(), `pb-${ymlKeyFor(os)}-${Date.now()}.yml`);
        try {
            writeFileSync(tmp, text);
            await r2Put(key, tmp, "text/yaml");
            p.log.success(`Feed ${key} uploaded.`);
        } finally {
            try {
                unlinkSync(tmp);
            } catch (err) {
                console.debug("temp yml already gone:", String(err));
            }
        }
    }
}

// ─── Flow: repair the live index from an existing release ───────────────────
// The binary flow uploads to GitHub, then writes the index. If the upload
// succeeded but the index write did not, the release exists but nothing can
// download. This re-derives the index from the bytes actually hosted on the
// release — it hashes the released assets and refuses when an expected one
// is missing, so it can never record a file that is not there.
async function flowRepublishIndex(yes: boolean): Promise<void> {
    p.intro(`Republish download index for v${version} (from the GitHub release)`);
    if (!isValidVersionSegment(version)) {
        fail(`Refusing version ${JSON.stringify(version)}: not a safe tag segment.`);
    }
    const signingKey = loadReleaseSigningKey();
    const tag = tagFor(version);

    await ensureGithubAuth();
    await ensureCloudflareAuth();

    let releaseAssets: Map<string, { size: number; digest: string | null }>;
    try {
        const raw = await sh(
            ["gh", "release", "view", tag, "--repo", GH_REPO, "--json", "assets"],
            { quiet: true },
        );
        const assets = (JSON.parse(raw) as {
            assets: { name: string; size: number; digest?: string | null }[];
        }).assets;
        releaseAssets = new Map(assets.map((a) => [a.name, { size: a.size, digest: a.digest ?? null }]));
    } catch (err) {
        fail(`Release ${tag} not found or unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }

    const jobs: { app: DlApp; target: Target; file: string }[] = [
        ...ALL_TARGETS.map((target) => ({ app: "pb" as DlApp, target, file: assetFileName("pb", target) })),
        ...ALL_TARGETS.map((target) => ({ app: "crane" as DlApp, target, file: assetFileName("crane", target) })),
    ];
    const missing = jobs.filter((j) => !releaseAssets.has(j.file)).map((j) => j.file);
    if (missing.length) {
        fail(`Release ${tag} is missing expected asset(s):\n  ${missing.join("\n  ")}`);
    }

    if (!yes) {
        if (!process.stdin.isTTY) {
            fail("Refusing to move the live index without a TTY; pass --yes to confirm.");
        }
        if (
            !checkCancel(
                await p.confirm({
                    message: `Hash the ${jobs.length} assets on ${tag} and move "latest" to v${version}?`,
                    initialValue: false,
                }),
            )
        ) {
            cancelled();
        }
    }

    // Prefer the staged bytes publish.ts uploaded (same files, no 1.3 GB
    // re-download) but verify each against the release's sha256 digest, so a
    // stale or changed local file can never be recorded. Missing/renamed
    // local files fall back to downloading the hosted asset.
    const stagedDir = join(HERE, "dist", "release");
    const dir = join(tmpdir(), `paperboard-index-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const staged: BuiltBinary[] = [];
    try {
        const dl = bar(jobs.length);
        for (const j of jobs) {
            const release = releaseAssets.get(j.file)!;
            const local = join(stagedDir, j.file);
            let filePath: string;
            if (existsSync(local) && statSync(local).size === release.size) {
                filePath = local;
            } else {
                await sh(
                    ["gh", "release", "download", tag, "--repo", GH_REPO, "--pattern", j.file, "--dir", dir, "--clobber"],
                    { quiet: true },
                );
                filePath = join(dir, j.file);
                if (!existsSync(filePath)) throw new Error(`gh did not download ${j.file}`);
            }
            const { sha256, sha512, size } = await hashFile(filePath);
            if (size !== release.size) {
                fail(`${j.file}: hashed size ${size} does not match the release's ${release.size}`);
            }
            if (release.digest) {
                const expected = release.digest.replace(/^sha256:/i, "");
                if (expected && expected !== sha256) {
                    fail(`${j.file}: sha256 does not match the release digest; refusing to index changed bytes`);
                }
            }
            staged.push({ app: j.app, target: j.target, filePath, filename: j.file, sha256, sha512, size });
            dl.increment(1, { task: j.file });
        }
        dl.stop();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    p.log.info("Hashed as hosted on the release:");
    printTable([
        ["file", "size", "sha256"],
        ...staged.map((b) => [b.filename, `${mb(b.size)} MB`, b.sha256.slice(0, 16)]),
    ]);

    await publishIndex(signingKey, version, staged);
    p.outro(`Index for v${version} is live.`);
}

// ─── Flow: publish panels ───────────────────────────────────────────────────

interface PanelInfo {
    dir: string;
    id: string;
    name: string;
    version: string;
}

function listPanels(): PanelInfo[] {
    return discoverPanels(PANELS_ROOT, (dirName, err) => {
        p.log.warn(
            `Skipping ${dirName}: ${err instanceof Error ? err.message : String(err)}`,
        );
    });
}

interface PackedPanel {
    info: PanelInfo;
    archivePath: string;
    bytes: Buffer;
    sha256: string;
    meta: Record<string, unknown>;
    store: ReturnType<typeof storeUploadParts>;
}

async function packPanel(info: PanelInfo): Promise<PackedPanel> {
    // listing files are read and validated before the build: a broken
    // listing refuses the publish instead of shipping a release without it
    const store = storeUploadParts(
        JSON.parse(readFileSync(join(info.dir, "manifest.json"), "utf8")).store,
        (rel) => readFileSync(join(info.dir, rel)),
    );
    await sh([process.execPath, "run", "build"], { cwd: info.dir, quiet: false });
    const outDir = join(tmpdir(), `paperboard-pack-${Date.now()}-${info.id}`);
    mkdirSync(outDir, { recursive: true });
    const archiveName = `${info.id}-${info.version}.tar.gz`;
    const archivePath = join(outDir, archiveName);

    const entriesToPack = ["manifest.json"];
    if (existsSync(join(info.dir, "dist"))) entriesToPack.push("dist");
    if (existsSync(join(info.dir, "branding"))) entriesToPack.push("branding");
    else if (existsSync(join(info.dir, "icon.png"))) entriesToPack.push("icon.png");

    tar.create({ gzip: true, file: archivePath, cwd: info.dir, sync: true }, entriesToPack);

    const bytes = readFileSync(archivePath);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const manifest = JSON.parse(readFileSync(join(info.dir, "manifest.json"), "utf8"));
    return {
        info,
        archivePath,
        bytes,
        sha256,
        store,
        meta: {
            id: info.id,
            name: info.name,
            version: info.version,
            description: manifest.description,
            icon: manifest.icon,
            sha256,
            sizeBytes: bytes.byteLength,
            manifest,
        },
    };
}

// Writes a packed panel straight to the registry through wrangler (the
// operator's Cloudflare session). There is no publish route and no registry
// key: the record URLs are baked from the canonical production origin.
async function publishPackedPanel(packed: PackedPanel): Promise<void> {
    const { info, bytes, meta, store } = packed;
    const iconPath = meta["icon"]
        ? join(info.dir, String(meta["icon"]).replace(/^\.\//, ""))
        : null;
    const files = new Map<string, Uint8Array>();
    for (const part of store.files) files.set(part.field, part.bytes);

    const upload: PanelUpload = {
        id: info.id,
        name: info.name,
        version: info.version,
        description:
            typeof meta["description"] === "string" ? meta["description"] : undefined,
        signature: String(meta["signature"]),
        manifest: meta["manifest"] as Record<string, unknown>,
        icon:
            iconPath && existsSync(iconPath)
                ? { name: basename(iconPath), bytes: readFileSync(iconPath) }
                : undefined,
        store: { about: store.about, files },
        archive: bytes,
    };
    await publishPanel(upload, {
        storage: createWranglerStorage(),
        origin: `https://${ORIGAMI_HOST}`,
    });
}

async function flowPublishPanels(): Promise<void> {
    p.intro("Publish panels");
    const panels = listPanels();
    if (!panels.length) fail("No panels with a valid manifest.json found under panels/.");
    const pickedIds = checkCancel(
        await p.multiselect({
            message: "Which panels to publish?",
            options: panels.map((x) => ({
                value: x.id,
                label: x.name,
                hint: `${x.id} v${x.version}`,
            })),
            required: true,
        }),
    ) as string[];
    const picked = panels.filter((x) => pickedIds.includes(x.id));
    // clients refuse unsigned releases: no key, nothing is packed or sent
    const signingKey = loadReleaseSigningKey();

    const packBar = bar(picked.length);
    const packed: PackedPanel[] = [];
    for (const info of picked) {
        p.log.step(`Packing ${info.name} (${info.id} v${info.version})…`);
        const x = await packPanel(info);
        x.meta.signature = signVerified(signingKey, releaseMessage.panel(info.id, info.version, x.sha256), info.id);
        packed.push(x);
        packBar.increment(1, { task: info.id });
    }
    packBar.stop();

    p.log.info("Ready to upload:");
    printTable([
        ["panel", "version", "size", "sha256"],
        ...packed.map((x) => [
            x.info.id,
            `v${x.info.version}`,
            `${mb(x.bytes.byteLength)} MB`,
            x.sha256.slice(0, 16),
        ]),
    ]);
    if (!checkCancel(await p.confirm({ message: `Publish ${packed.length} panel(s) to the registry?`, initialValue: false }))) {
        cancelled();
    }

    const upBar = bar(packed.length);
    for (const x of packed) {
        await publishPackedPanel(x);
        try {
            unlinkSync(x.archivePath);
        } catch (err) {
            console.debug("temp archive already gone:", String(err));
        }
        upBar.increment(1, { task: x.info.id });
    }
    upBar.stop();

    p.log.success("Published:");
    printTable(packed.map((x) => [x.info.id, `${ORIGAMI_URL}/panel/${x.info.id}/download`]));
    p.outro("Registry updated. Previous panel versions are retained server-side.");
}

// ─── Flow: publish npm packages ─────────────────────────────────────────────

interface NpmPackage {
    dir: string;
    name: string;
    version: string;
}

function listPackages(): NpmPackage[] {
    const pkgsRoot = join(HERE, "..", "..", "packages");
    const out: NpmPackage[] = [];
    if (!existsSync(pkgsRoot)) return out;
    for (const e of readdirSync(pkgsRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const pkgPath = join(pkgsRoot, e.name, "package.json");
        if (!existsSync(pkgPath)) continue;
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
                name?: unknown;
                version?: unknown;
                private?: unknown;
                scripts?: Record<string, string>;
            };
            if (pkg.private) continue;
            if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
            if (!pkg.scripts?.build) continue;
            out.push({ dir: join(pkgsRoot, e.name), name: pkg.name, version: pkg.version });
        } catch (err) {
            p.log.warn(
                `Skipping ${e.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function flowPublishPackages(): Promise<void> {
    p.intro("Publish npm packages");
    const pkgs = listPackages();
    if (!pkgs.length) fail("No publishable packages found under packages/ (need name, version, and a build script).");
    const pickedNames = checkCancel(
        await p.multiselect({
            message: "Which packages to publish?",
            options: pkgs.map((x) => ({ value: x.name, label: x.name, hint: `v${x.version}` })),
            required: true,
        }),
    ) as string[];
    const picked = pkgs.filter((x) => pickedNames.includes(x.name));

    const buildBar = bar(picked.length);
    for (const x of picked) {
        p.log.step(`Building ${x.name} v${x.version}…`);
        await sh([process.execPath, "run", "build"], { cwd: x.dir, quiet: false });
        buildBar.increment(1, { task: x.name });
    }
    buildBar.stop();

    p.log.info("Ready to publish:");
    printTable(picked.map((x) => [x.name, `v${x.version}`]));
    if (!checkCancel(await p.confirm({ message: `Publish ${picked.length} package(s) to npm?`, initialValue: false }))) {
        cancelled();
    }

    if (!(await cmdOk(["npm", "--version"]))) {
        fail("npm not found on PATH. Install Node.js/npm, then re-run.");
    }
    if (!(await cmdOk(["npm", "whoami"]))) {
        p.log.warn("npm: not logged in — opening `npm login`…");
        await sh(["npm", "login"], { quiet: false });
        if (!(await cmdOk(["npm", "whoami"]))) {
            fail("npm login did not complete. Aborting before anything publishes.");
        }
    }

    const pubBar = bar(picked.length);
    for (const x of picked) {
        await sh(["npm", "publish"], { cwd: x.dir, quiet: false });
        pubBar.increment(1, { task: x.name });
    }
    pubBar.stop();

    p.log.success("Published:");
    printTable(
        picked.map((x) => [x.name, `https://www.npmjs.com/package/${x.name}/v/${x.version}`]),
    );
    p.outro("npm updated.");
}

// ─── USB test bundle (headless-capable, OS-selectable) ──────────────────────
// Builds Paperboard installers + crane binaries + all panels into ../usb/:
//
//   usb/
//     installers/    win setup exe, mac ZIP, linux AppImage (per selected arch)
//     crane/         papercrane-<target> binaries
//     panels/        <board-id>/ (manifest.json + dist/ + branding/)
//     link-panels.sh symlinks panels/ into ~/.paperboard/panels/ for testing
//     README.txt
//
// Only the requested operating systems and architectures are bundled: a
// Windows-only or arm64-only run skips the other crane/target builds and
// stages only the selected installers. (macOS still compiles both arches in
// its single electron-builder pass; only the selected ZIPs are copied.)
//
//   bun scripts/publish.ts usb                       # pick OSes+arches (TTY)
//   bun scripts/publish.ts usb --os windows          # Windows only
//   bun scripts/publish.ts usb --os linux,macos      # comma-separated
//   bun scripts/publish.ts usb --arch arm64          # arm64 targets only
//
// Never publishes anything. Copy the folder onto a USB stick and test anywhere.

function printUsbHelp(): void {
    console.log(`Build a USB test bundle (never uploads).

  bun scripts/publish.ts usb                       pick OSes+arches interactively
  bun scripts/publish.ts usb --os windows          Windows only
  bun scripts/publish.ts usb --os linux,macos      several, comma-separated
  bun scripts/publish.ts usb --os windows --os macos
  bun scripts/publish.ts usb --arch arm64          arm64 targets only
  bun scripts/publish.ts usb --os linux --arch x64,arm64

Options:
  -o, --os <list>     windows, macos, linux (comma-separated or repeated)
  -a, --arch <list>   x64, arm64 (comma-separated or repeated)
  -h, --help          show this help`);
}

async function chooseUsbOses(requested: Os[] | null): Promise<Os[]> {
    if (requested) return requested;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log("No TTY — bundling every OS (pass `--os <list>` to narrow it).");
        return [...USB_OSES];
    }
    const picked = checkCancel(
        await p.multiselect({
            message: "Which operating systems to bundle?",
            options: USB_OSES.map((os) => ({
                value: os,
                label: os,
                hint: `${targetsForOses([os]).length} server target(s)`,
            })),
            required: true,
        }),
    ) as Os[];
    if (!picked.length) cancelled();
    return picked;
}

async function chooseUsbArches(requested: Arch[] | null): Promise<Arch[]> {
    if (requested) return requested;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log("No TTY — bundling every architecture (pass `--arch <list>` to narrow it).");
        return [...USB_ARCHES];
    }
    const picked = checkCancel(
        await p.multiselect({
            message: "Which architectures to bundle?",
            options: USB_ARCHES.map((arch) => ({
                value: arch,
                label: arch,
                hint: `${targetsForOses(USB_OSES, [arch]).length} server target(s)`,
            })),
            required: true,
        }),
    ) as Arch[];
    if (!picked.length) cancelled();
    return picked;
}

async function buildUsbFolder(oses: Os[], arches: Arch[]) {
    const USB = join(HERE, "..", "usb");
    const usbDistDir = join(HERE, "dist");
    const installersDir = join(USB, "installers");
    const craneDir = join(USB, "crane");
    const panelsDir = join(USB, "panels");
    const selected = new Set(oses);
    const selectedArches = new Set(arches);

    console.log(
        `\n💾 Building USB test bundle (paperboard v${version}; ${oses.join(", ")}; ${arches.join(", ")}) → ${USB}\n`,
    );
    rmSync(USB, { recursive: true, force: true });
    mkdirSync(installersDir, { recursive: true });
    mkdirSync(craneDir, { recursive: true });
    mkdirSync(panelsDir, { recursive: true });

    // A packaged mac app gets a pty helper that can never execute unless
    // its exec bit is restored first. (Runtime self-heal in pty.ts covers
    // copies; this covers the build.)
    if (selected.has("macos")) ensureMacSpawnHelpers();

    const snapshotDist = () => Date.now();
    const copyNew = (buildStart: number, dest: string, match: (f: string) => boolean) => {
        // Rebuilds overwrite the same filename, so freshness is by mtime.
        const fresh = readdirSync(usbDistDir).filter((f) => {
            if (!match(f)) return false;
            try {
                return statSync(join(usbDistDir, f)).mtimeMs >= buildStart - 5000;
            } catch (err) {
                console.debug("stat raced deletion, skipping:", String(err));
                return false;
            }
        });
        for (const f of fresh) cpSync(join(usbDistDir, f), join(dest, f));
        return fresh;
    };

    // 1. Paperboard installers per OS (macOS ZIPs are copied below)
    const osBuilds: {
        os: Os;
        arch: Arch;
        script: string;
        match: (f: string) => boolean;
    }[] = [
        { os: "windows", arch: "x64", script: "build:win", match: (f) => f.endsWith("-setup.exe") },
        { os: "linux", arch: "x64", script: "build:linux", match: (f) => f.endsWith(".AppImage") },
        { os: "linux", arch: "arm64", script: "build:linux-arm64", match: (f) => f.endsWith(".AppImage") },
    ];
    const installerFiles: string[] = [];
    for (const { os, arch, script, match } of osBuilds) {
        if (!selected.has(os) || !selectedArches.has(arch)) continue;
        console.log(`\n🔨 Building Paperboard for ${os}…\n`);
        const before = snapshotDist();
        await $`bun run ${script}`.cwd(HERE);
        const fresh = copyNew(before, installersDir, match);
        if (!fresh.length) throw new Error(`No fresh installer found in ${usbDistDir} after ${script}`);
        installerFiles.push(...fresh.map((f) => `installers/${f}`));
        console.log(`   → ${fresh.join(", ")}`);
    }

    // Bundle the same macOS ZIPs we publish (installer and updater payload).
    if (selected.has("macos")) {
        console.log(`\n🔨 Building Paperboard for macos…\n`);
        const before = snapshotDist();
        await $`bun run build:mac`.cwd(HERE);
        for (const target of targetsForOses(["macos"], arches)) {
            const installer = paperboardArtifacts(target, version);
            const fresh = copyNew(before, installersDir, (f) => f === installer.buildFile);
            if (!fresh.length) throw new Error(`No fresh macOS ZIP found: ${installer.buildFile}`);
            installerFiles.push(...fresh.map((f) => `installers/${f}`));
            console.log(`   → ${fresh.join(", ")}`);
        }
    }

    // 2. Crane binaries, limited to the selected OSes
    const craneFiles: string[] = [];
    for (const target of targetsForOses(oses, arches)) {
        const os = osOf(target);
        const bunTarget = BUN_TARGET_MAP[target];
        const outName = os === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
        console.log(`\n🔨 Building Paperboard Server for ${target}…`);
        await $`bun build --compile --target=${bunTarget} ${craneCompileFlags(target)} ./papercrane/main.ts --outfile ./dist/${outName}`.cwd(HERE);
        const built = join(usbDistDir, outName);
        if (!existsSync(built)) throw new Error(`No Paperboard Server binary found at ${built}`);
        if (os === "windows") applyCraneWindowsIcon(built);
        cpSync(built, join(craneDir, outName));
        craneFiles.push(`crane/${outName}`);
    }

    if (selected.has("windows")) {
        writeNodePtySidecar(craneDir, join(HERE, "node_modules", "node-pty"));
        console.log(`   → node-pty sidecar (win32-x64)`);
    }

    // 3. All panels under panels/ (shared discovery with the publish flow —
    // listPanels reads the same root, validates each manifest, and reports
    // failures instead of silently bundling nothing).
    const panelEntries: { id: string; name: string; version: string }[] = [];
    for (const info of listPanels()) {
        console.log(`\n📦 Building panel ${info.id}…\n`);
        await $`bun run build`.cwd(info.dir);
        const dest = join(panelsDir, info.id);
        mkdirSync(dest, { recursive: true });
        cpSync(join(info.dir, "manifest.json"), join(dest, "manifest.json"));
        if (existsSync(join(info.dir, "dist"))) cpSync(join(info.dir, "dist"), join(dest, "dist"), { recursive: true });
        if (existsSync(join(info.dir, "branding"))) {
            cpSync(join(info.dir, "branding"), join(dest, "branding"), { recursive: true });
        } else if (existsSync(join(info.dir, "icon.png"))) {
            cpSync(join(info.dir, "icon.png"), join(dest, "icon.png"));
        }
        panelEntries.push({ id: info.id, name: info.name, version: info.version });
    }
    if (!panelEntries.length) {
        throw new Error(
            `No panels found under ${PANELS_ROOT} — the USB bundle would ship without panels.`,
        );
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

    const readme = `Paperboard v${version} USB test bundle (built ${new Date().toISOString()})

INSTALLERS (installers/)
${installerFiles.map((f) => `  ${f}`).join("\n")}

  Install: Windows -> run the setup exe; macOS -> unzip and drag
  Paperboard.app to Applications; Linux -> chmod +x the .AppImage, then run it.

  PAPERBOARD SERVER BINARIES (crane/)
  Standalone Paperboard server daemon per target. Mostly useful for headless boxes:
    ./papercrane-linux-x64 --help
  Plus node-pty/: helper files the Windows binary needs for real terminal
  emulation (keep the folder next to the .exe).
${craneFiles.map((f) => `  ${f}`).join("\n")}

PANELS (panels/)
${panelEntries.map((p) => `  ${p.id} (${p.name} v${p.version})`).join("\n")}

  Panels are prebuilt (dist/ included). To test them:
    1. Copy this folder anywhere, e.g. ~/paperboard-usb
    2. USB sticks strip executable bits; restore them first:
         macOS/Linux: chmod +x crane/* link-panels.sh
         (Windows .exe files are unaffected.)
    3. ./link-panels.sh  (macOS/Linux) or double-click link-panels.bat (Windows)
       (symlinks/junctions each panel into ~/.paperboard/panels/)
    4. (Re)start Paperboard; linked panels load as-is

  Set PAPERBOARD_DIR=... before running the script to target a custom data dir.
  The Paperboard Server never overwrites a symlinked panel on registry install.

  LAN PAIRING / WINDOWS FIREWALL
  Remote devices reach the Paperboard server daemon over TLS on its port (default 45464).
  Pairing trusts the certificate the daemon shows the first time, and every later
  connection is pinned to it, so pair on a home or other trusted network you control.
  On Windows, accept the Firewall first-listen prompt for the server/app binary.
  If remote pairing times out while localhost works, the prompt was declined
  or the binary moved: add an inbound exception manually (Windows Defender
  Firewall > Allow an app through firewall > papercrane). macOS/Linux need
  nothing (no default firewall blocks).
`;
    writeFileSync(join(USB, "README.txt"), readme);

    console.log(`\n✅ USB bundle ready → ${USB}`);
    console.log(`   ${installerFiles.length} installer(s), ${craneFiles.length} server binaries, ${panelEntries.length} panel(s)`);
    console.log(`   Copy the folder onto a USB stick and run ./link-panels.sh on the test machine.\n`);
}

// ─── Menu ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv[0] === "usb") {
        const { oses, arches, help } = parseUsbArgs(argv.slice(1));
        if (help) {
            printUsbHelp();
            return;
        }
        await buildUsbFolder(await chooseUsbOses(oses), await chooseUsbArches(arches));
        return;
    }
    if (argv[0] === "republish-index") {
        await flowRepublishIndex(argv.includes("--yes"));
        return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("publish.ts is interactive — run it in a terminal (or `bun scripts/publish.ts usb` / `bun scripts/publish.ts republish-index --yes` headless).");
        process.exit(1);
    }

    p.intro("Paperboard publisher");
    const choice = checkCancel(
        await p.select({
            message: "What would you like to do?",
            options: [
                { value: "build", label: "Build binaries", hint: "local only — pick app/server targets" },
                { value: "publish-bin", label: "Publish binaries", hint: "build all, confirm twice, upload" },
                { value: "panels", label: "Publish panels", hint: "pick panels, pack, upload to registry" },
                { value: "packages", label: "Publish packages", hint: "pick npm packages, build, npm publish" },
                { value: "usb", label: "Build USB test bundle", hint: "sneakernet testing, never uploads" },
            ],
        }),
    );

    switch (choice) {
        case "build":
            await flowBuildBinaries();
            break;
        case "publish-bin":
            await flowPublishBinaries();
            break;
        case "panels":
            await flowPublishPanels();
            break;
        case "packages":
            await flowPublishPackages();
            break;
        case "usb":
            await buildUsbFolder(await chooseUsbOses(null), await chooseUsbArches(null));
            break;
        default:
            cancelled();
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
