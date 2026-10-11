import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { ServiceContext } from "@mileniumhq/paperapi";
import type { FileDownloadProgress } from "@mileniumhq/paperapi";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import { providerFor } from "../software/providers";
import type { SoftwareProvider } from "../software/types";
import { DEFAULT_LAUNCH, detectInstallerLaunch, type LaunchSpec } from "../software/launch";
import { currentInstall, INSTALL_RECORD_KEY, type InstallRecord } from "../software/installRecord";
import {
    activateStagedInstall,
    newStagingName,
    recoverStagedInstalls,
    stagedFilesPath,
    type ActivationFs,
    type RecoveryResult,
} from "./activation";
import { InstallerStillRunningError, type InstallerResult, type InstallerRun } from "./installerProcess";
import { shouldRelayInstallProgress, toInstallProgress, type InstallProgress } from "./installProgress";
import type { GameServerState } from "./types";

// Installs a server software for a Minecraft version: resolve the build,
// download it (and run its installer when it has one) into a staging
// folder, swap it into the server folder, record what was installed. The
// one install path: onboarding and the Versions tab both call the
// install-server-version action, which lands here.

export interface InstallDeps {
    serverDir(): Promise<string>;
    /** downloads into the server folder; targetPath is relative to it */
    download(opts: {
        url: string;
        targetPath: string;
        sha1?: string;
        sha256?: string;
        onProgress?: (progress: FileDownloadProgress) => void;
    }): Promise<unknown>;
    /** absolute path of the java binary, installing the runtime if missing */
    javaBinary(mcVersion: string): Promise<{ bin: string; home: string }>;
    runInstaller(run: InstallerRun): Promise<InstallerResult>;
    readConfig(): Promise<Record<string, unknown>>;
    writeConfig(patch: Record<string, unknown>): Promise<void>;
    provider?: (id: ServerSoftwareType) => SoftwareProvider;
    fs?: ActivationFs;
}

export interface InstallOutcome {
    software: ServerSoftwareType;
    version: string;
    build: string | null;
    /** set when the install succeeded but leftover cleanup did not */
    warning?: string;
}

let running = false;

/** True while an install owns the server folder; starting the server is refused. */
export function isInstallRunning(): boolean {
    return running;
}

function fsOf(deps: InstallDeps): ActivationFs {
    return deps.fs ?? (nodeFs as unknown as ActivationFs);
}

/**
 * Runs `work` as the one thing that owns the server folder: a second
 * install, a modpack change or a server start is refused until it ends.
 * The claim is synchronous, so a caller that checks "offline" just before
 * cannot race a start.
 */
export async function withInstallLock<T>(work: () => Promise<T>): Promise<T> {
    if (running) throw new Error("A server install is already running");
    running = true;
    try {
        return await work();
    } finally {
        running = false;
    }
}

export function installServerSoftware(
    ctx: ServiceContext<GameServerState>,
    software: ServerSoftwareType,
    version: string,
    deps: InstallDeps,
    opts: { build?: string } = {},
): Promise<InstallOutcome> {
    return withInstallLock(() => install(ctx, software, version, deps, opts.build));
}

/** installServerSoftware for a caller already inside withInstallLock (a modpack install). */
export async function installServerSoftwareLocked(
    ctx: ServiceContext<GameServerState>,
    software: ServerSoftwareType,
    version: string,
    deps: InstallDeps,
    opts: { build?: string } = {},
): Promise<InstallOutcome> {
    if (!running) throw new Error("installServerSoftwareLocked called without the install lock");
    return install(ctx, software, version, deps, opts.build);
}

async function install(
    ctx: ServiceContext<GameServerState>,
    software: ServerSoftwareType,
    version: string,
    deps: InstallDeps,
    pinnedBuild: string | undefined,
): Promise<InstallOutcome> {
    const fs = fsOf(deps);
    const provider = (deps.provider ?? providerFor)(software);
    const name = SOFTWARE[software].name;

    let lastProgress: InstallProgress | null = null;
    const publish = (next: InstallProgress) => {
        if (!shouldRelayInstallProgress(lastProgress, next)) return;
        lastProgress = next;
        ctx.setState({ installProgress: next });
    };
    ctx.setState({ installProgress: null });

    // read before anything is staged: an unreadable record stops the
    // install instead of leaving the old files unremovable
    const previous = currentInstall(await deps.readConfig());
    const java = await deps.javaBinary(version);
    const resolved = await provider.resolveBuild(version, pinnedBuild);

    const root = await deps.serverDir();
    const staging = newStagingName();
    const stagedRel = stagedFilesPath(staging);
    const stagedAbs = nodePath.join(root, staging, "server");
    await fs.mkdir(stagedAbs, { recursive: true });

    let keepStaging = false;
    let activation: Awaited<ReturnType<typeof activateStagedInstall>> | null = null;
    try {
        const onProgress = (payload: FileDownloadProgress) => {
            const next = toInstallProgress(payload);
            // the installer step follows; "completed" belongs to the whole install
            if (next && next.stage !== "completed") publish(next);
        };

        let launch: LaunchSpec;
        if (provider.install.type === "jar") {
            await deps.download({
                url: resolved.artifact.url,
                targetPath: `${stagedRel}/server.jar`,
                sha1: resolved.artifact.sha1,
                sha256: resolved.artifact.sha256,
                onProgress,
            });
            launch = DEFAULT_LAUNCH;
        } else {
            const plan = provider.install;
            const build = resolved.build;
            if (!build) throw new Error(`${name} resolved no build for Minecraft ${version}`);
            await deps.download({
                url: resolved.artifact.url,
                targetPath: `${staging}/installer.jar`,
                sha1: resolved.artifact.sha1,
                sha256: resolved.artifact.sha256,
                onProgress,
            });
            publish({ stage: "installing", percent: 0 });
            let result: InstallerResult;
            try {
                result = await deps.runInstaller({
                    javaBin: java.bin,
                    args: plan.args(nodePath.join(root, staging, "installer.jar"), stagedAbs),
                    cwd: nodePath.join(root, staging),
                    env: { JAVA_HOME: java.home },
                });
            } catch (err) {
                // never clean a folder something may still be writing into;
                // service-start recovery removes it once the installer is gone
                if (err instanceof InstallerStillRunningError) keepStaging = true;
                throw err;
            }
            if (result.exitCode !== 0) {
                const detail = result.tail.slice(-5).join("\n");
                throw new Error(
                    `The ${name} installer failed (exit code ${result.exitCode})${detail ? `:\n${detail}` : ""}`,
                );
            }
            const detected = await detectInstallerLaunch(
                plan.launchCandidates(version, build),
                async (relative) => {
                    try {
                        await fs.lstat(nodePath.join(stagedAbs, ...relative.split("/")));
                        return true;
                    } catch (err) {
                        if ((err as { code?: string } | null)?.code === "ENOENT") return false;
                        throw err;
                    }
                },
            );
            if (!detected) {
                throw new Error(
                    `The ${name} installer reported success but left no server to launch for ${name} ${build}`,
                );
            }
            launch = detected;
        }

        activation = await activateStagedInstall({
            root,
            staging,
            replaced: previous.files,
            fs,
        });

        const record: InstallRecord = {
            software,
            version,
            build: resolved.build,
            launch,
            files: activation.installed,
            staging,
        };
        try {
            await deps.writeConfig({ software, version, [INSTALL_RECORD_KEY]: record });
        } catch (err) {
            await activation.rollback();
            activation = null;
            throw new Error(
                `Could not record the new install, so the previous server was restored: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        // recorded: from here the new install is the server. A failed
        // cleanup does not undo that; the next service start finishes it.
        let warning: string | undefined;
        try {
            await activation.commit();
        } catch (err) {
            warning = `${name} ${version} is installed, but removing the previous server files failed (${err instanceof Error ? err.message : String(err)}). Paperboard retries when the panel service restarts.`;
            console.error("[Service:Install] commit cleanup failed:", err);
        }
        publish({ stage: "completed", percent: 100 });
        return { software, version, build: resolved.build, ...(warning ? { warning } : {}) };
    } catch (err) {
        ctx.setState({ installProgress: { stage: "error", percent: 0 } });
        if (!activation && !keepStaging) {
            await fs.rm(nodePath.join(root, staging), { recursive: true, force: true });
        }
        throw err;
    }
}

/**
 * Settles what an interrupted install left: stops a leftover installer,
 * then commits or rolls back staging folders against the recorded install.
 */
export async function recoverInterruptedInstall(deps: {
    serverDir(): Promise<string>;
    readConfig(): Promise<Record<string, unknown>>;
    stopLeftoverInstaller(): Promise<boolean>;
    fs?: ActivationFs;
}): Promise<RecoveryResult> {
    await deps.stopLeftoverInstaller();
    const { record } = currentInstall(await deps.readConfig());
    return recoverStagedInstalls(await deps.serverDir(), record?.staging ?? null, deps.fs);
}
