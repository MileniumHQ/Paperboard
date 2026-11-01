import { minecraftSoftware } from "./index";
import { config, files as fileApi, packages as packageApi, system, type ServiceContext } from "../../service/api";
import type { GameServerState } from "../../service/types";
import { PANEL_ID } from "../../service/types";
import { SOFTWARE_NAMES } from "../../lib/software";
import { isWindowsTarget } from "../../lib/platform";
import { currentInstall } from "../../software/installRecord";
import * as nodeFs from "node:fs/promises";
import { javaLaunchArgs, launchEntryFile } from "../../software/launch";
import { isSupportedMcVersion, MIN_SUPPORTED_MC_VERSION } from "../../lib/versionProfile";
import { javaBinaryPath } from "./java";
import { minecraft } from "./index";
import type { PreparedLaunch } from "../serviceTypes";

export async function prepareLaunch(ctx: ServiceContext<GameServerState>): Promise<PreparedLaunch> {
    const saved = await config.get<Record<string, unknown>>(PANEL_ID);
    let version = ctx.state.serverVersion;
    if (!version && typeof saved?.version === "string" && saved.version) {
        version = saved.version;
        ctx.setState({ serverVersion: version });
    }

    if (version && !isSupportedMcVersion(version)) {
        throw new Error(
            `Minecraft ${version} is below Paperboard's minimum supported version (${MIN_SUPPORTED_MC_VERSION}).`,
        );
    }

    const javaPkg = minecraft.describe({ software: minecraftSoftware(ctx.state.serverSoftware), version }).packages[0]?.id;
    if (!javaPkg) {
        throw new Error(
            `Could not determine the Minecraft version (got ${JSON.stringify(version)}) — complete Setup before starting the server.`,
        );
    }
    const isInstalled = await packageApi.isInstalled(javaPkg).catch(() => false);
    if (!isInstalled) {
        throw new Error(
            `Required Java package "${javaPkg}" is not installed. Please run Setup or install it in Packages.`,
        );
    }

    const javaPath = await packageApi.getPath(javaPkg);
    const serverDir = await fileApi.getPath("", PANEL_ID);
    const targetOs = (await system.getInfo()).os;
    const isWin = isWindowsTarget(serverDir, targetOs);
    // launch what the last install recorded; a pre-record install is a
    // plain server.jar
    const { launch } = currentInstall(saved);
    const entry = launchEntryFile(launch, isWin);
    const softwareName = SOFTWARE_NAMES[minecraftSoftware(ctx.state.serverSoftware)];
    // fail here instead of a confusing "unable to access jarfile" exit
    const hasEntry = await fileApi.exists(entry, PANEL_ID).catch(() => false);
    if (!hasEntry) {
        throw new Error(
            `${entry} is missing in the server folder — reinstall ${softwareName} ${version || ""} from Versions (or run Setup) before starting.`,
        );
    }
    console.log(
        `[Service:Lifecycle] starting in ${serverDir} (${entry} present) using ${javaPkg}...`,
    );
    const javaBin = javaBinaryPath(javaPath, isWin);

    return {
        command: {
            executable: javaBin,
            args: javaLaunchArgs(launch, { ramGb: ctx.state.ramAllocation, javaMajor: javaMajorOf(javaPkg), hugePages: targetOs.toLowerCase() === "linux" && (await transparentHugePages()) }, isWin),
            cwd: serverDir,
            env: { JAVA_HOME: javaPath },
        },
        message: `[Server] Starting ${softwareName} ${version || "server"} using ${javaPkg}...`,
    };
}

/** The major version in a Java package id: "java-21" is 21. */
export function javaMajorOf(javaPkg: string): number {
    const major = Number(/^java-(\d+)$/.exec(javaPkg)?.[1]);
    if (!major) throw new Error(`"${javaPkg}" is not a Java runtime package`);
    return major;
}

/** Whether Linux lets the JVM back its heap with transparent huge pages; a kernel without them has no file to read. */
export async function transparentHugePages(file = "/sys/kernel/mm/transparent_hugepage/enabled"): Promise<boolean> {
    try {
        // "always [madvise] never": the bracketed mode is the current one
        return /\[(always|madvise)\]/.test(await nodeFs.readFile(file, "utf8"));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw err;
    }
}
