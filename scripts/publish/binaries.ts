// Building the app and the server: the local "Build binaries" flow, and
// ci-build, which the release workflow runs on each target's own runner.
import * as p from "@clack/prompts";
import AdmZip from "adm-zip";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import * as tar from "tar";
import { craneCompileCommand } from "../supervisor";
import {
    ALL_TARGETS,
    assetFileName,
    isUpdatePayload,
    isValidVersionSegment,
    missingLinuxPackageTools,
    osOf,
    paperboardArtifacts,
    paperboardPackages,
    type DlApp,
    type Target,
} from "../publishLib";
import { applyWindowsIcon } from "../windowsIcon";
import { APP_DIR, bar, checkCancel, hashFile, mb, printTable, REPO_ROOT, sh, version } from "./common";

const PB_BUILD_SCRIPT: Record<Target, string> = {
    "linux-x64": "build:linux",
    "linux-arm64": "build:linux-arm64",
    "macos-x64": "build:mac-x64",
    "macos-arm64": "build:mac-arm64",
    "windows-x64": "build:win",
};

export const distDir = join(APP_DIR, "dist");

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
// every host so a Linux/macOS cross-build never ships Bun's default logo.
function applyCraneWindowsIcon(filePath: string): void {
    const icon = join(APP_DIR, "papercrane", "branding", "icon.ico");
    if (!existsSync(icon)) {
        throw new Error(`The Windows server's icon is missing (${icon}); it would ship with Bun's default logo.`);
    }
    applyWindowsIcon(filePath, icon);
}

export interface BuiltBinary {
    app: DlApp;
    target: Target;
    filePath: string;
    filename: string;
    // the canonical name on the release
    releaseFile: string;
    sha256: string;
    sha512: string;
    size: number;
}

// macOS runs only signed arm64 code and reports an unsigned download as
// "damaged", and only a Mac can sign it. A macOS build made anywhere else
// would ship broken, so it is refused; the release workflow builds macOS on
// Apple's own runners.
function assertMacHost(target: Target): void {
    if (osOf(target) === "macos" && process.platform !== "darwin") {
        throw new Error(
            `${target} builds only on a Mac: off a Mac it can't be signed, and macOS refuses it. Publish binaries builds it in the release workflow.`,
        );
    }
}

// electron-builder makes the rpm with rpmbuild, which is not part of it: a
// host without it fails only after the AppImage and deb are built
function assertLinuxPackageTools(): void {
    const missing = missingLinuxPackageTools(Bun.which);
    if (missing) throw new Error(missing);
}

// Ad-hoc signs a compiled macOS server binary in place and checks the
// signature holds. There is no Developer ID yet, so ad-hoc is the signature.
async function signMacBinary(filePath: string): Promise<void> {
    await sh(["codesign", "--force", "--sign", "-", filePath], { quiet: true });
    await sh(["codesign", "--verify", "--strict", filePath], { quiet: true });
}

// One electron-builder pass per target: the update payload first, then any
// distro packages the same pass produced (Linux).
async function buildPbTarget(target: Target): Promise<BuiltBinary[]> {
    assertMacHost(target);
    await sh([process.execPath, "run", PB_BUILD_SCRIPT[target]], { quiet: false });
    const artifacts = [paperboardArtifacts(target, version), ...paperboardPackages(target, version)];
    const built: BuiltBinary[] = [];
    for (const artifact of artifacts) {
        const filePath = join(distDir, artifact.buildFile);
        if (!existsSync(filePath)) throw new Error(`Missing ${target} artifact: ${filePath}`);
        const { sha256, sha512, size } = await hashFile(filePath);
        built.push({
            app: "pb",
            target,
            filePath,
            filename: artifact.buildFile,
            releaseFile: artifact.releaseFile,
            sha256,
            sha512,
            size,
        });
    }
    return built;
}

async function buildCraneTarget(target: Target): Promise<BuiltBinary> {
    assertMacHost(target);
    const outName =
        osOf(target) === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
    const filePath = join(distDir, outName);
    const { cmd, cwd } = craneCompileCommand(filePath, target, craneCompileFlags(target));
    await sh(cmd, { cwd, quiet: false });
    if (!existsSync(filePath))
        throw new Error(`No Paperboard Server binary found at ${filePath}`);
    if (osOf(target) === "windows") applyCraneWindowsIcon(filePath);
    if (osOf(target) === "macos") await signMacBinary(filePath);
    const { sha256, sha512, size } = await hashFile(filePath);
    return {
        app: "crane",
        target,
        filePath,
        filename: basename(filePath),
        releaseFile: assetFileName("crane", target),
        sha256,
        sha512,
        size,
    };
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
        const file = b.releaseFile;
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

// The app bundles PaperAPI and PaperUI from their built dist/, which is
// never committed: built fresh, so a release never ships a stale one.
async function buildWorkspacePackages(): Promise<void> {
    for (const pkg of ["paperapi", "paperui"]) {
        await sh([process.execPath, "run", "build"], { cwd: join(REPO_ROOT, "packages", pkg), quiet: false });
    }
}

// Build the selected app/target jobs, each hashed as produced. Shared by the
// interactive build flow and the release workflow's ci-build, which then
// stages the canonical release assets with stageReleaseAssets.
async function buildSelected(jobs: { app: DlApp; target: Target }[]): Promise<BuiltBinary[]> {
    if (jobs.some((j) => j.app === "pb" && osOf(j.target) === "linux")) assertLinuxPackageTools();
    if (jobs.some((j) => j.app === "pb")) await buildWorkspacePackages();
    const progress = bar(jobs.length);
    const built: BuiltBinary[] = [];
    for (const j of jobs) {
        const b =
            j.app === "pb" ? await buildPbTarget(j.target) : [await buildCraneTarget(j.target)];
        built.push(...b);
        progress.increment(1, { task: `${j.app} ${j.target}` });
    }
    progress.stop();
    return built;
}

// ─── Flow: build binaries (local only) ──────────────────────────────────────

export async function flowBuildBinaries(): Promise<void> {
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

    // Local record (informational).
    for (const app of ["pb", "crane"] as DlApp[]) {
        const mine = built.filter((b) => b.app === app);
        if (!mine.length) continue;
        const record: Record<string, unknown> = {};
        for (const b of mine) {
            const key = isUpdatePayload(b.filename) ? b.target : `${b.target}-${extname(b.filename).slice(1)}`;
            record[key] = {
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

// ─── Flow: CI build (one target, in the release workflow) ───────────────────

// What the release workflow runs on each target's own runner: the app and
// the server for that target, staged under dist/release/ by their release
// names for the workflow to smoke and put on the draft release.
export async function flowCiBuild(argv: string[]): Promise<void> {
    const at = argv.indexOf("--target");
    const target = at >= 0 ? argv[at + 1] : undefined;
    if (!target || !(ALL_TARGETS as string[]).includes(target)) {
        throw new Error(`ci-build --target must be one of ${ALL_TARGETS.join(", ")}, got ${JSON.stringify(target ?? null)}`);
    }
    if (!isValidVersionSegment(version)) {
        throw new Error(`Refusing to build version ${JSON.stringify(version)}: it is not a safe URL/tag segment.`);
    }
    const built = await buildSelected([
        { app: "pb", target: target as Target },
        { app: "crane", target: target as Target },
    ]);
    const staged = await stageReleaseAssets(built);
    console.log(`\nStaged v${version} for ${target} in ${join(distDir, "release")}:`);
    printTable([
        ["file", "size", "sha256"],
        ...staged.map((b) => [b.filename, `${mb(b.size)} MB`, b.sha256]),
    ]);
}
