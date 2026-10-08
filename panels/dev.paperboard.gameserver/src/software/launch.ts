import { isListableDirArg } from "../core/dirs";

// How the server process is started, recorded at install time from the
// files the install actually produced. Lifecycle launches from this record
// instead of assuming `java -jar server.jar`.
//
//   jar      java -Xmx… -jar <jar> nogui
//            vanilla, Paper, Fabric's launcher, Forge up to 1.16.5
//   argfile  java -Xmx… @<args file> nogui
//            NeoForge and Forge 1.17+: the installer writes a classpath
//            argument file per OS (unix_args.txt with `:` separators,
//            win_args.txt with `;`), and there is no runnable server jar
export type LaunchSpec =
    | { type: "jar"; jar: string }
    | { type: "argfile"; unix: string; windows: string };

// what every install before launch records existed wrote: a single jar
export const DEFAULT_LAUNCH: LaunchSpec = { type: "jar", jar: "server.jar" };

/**
 * Validates a recorded launch spec. Every path is a relative chain of safe
 * segments inside the server folder: the record is read back from panel
 * config, and a path that climbs out would hand java a classpath from
 * anywhere on the computer.
 */
export function parseLaunchSpec(raw: unknown): LaunchSpec | null {
    if (typeof raw !== "object" || raw === null) return null;
    const spec = raw as Record<string, unknown>;
    if (spec.type === "jar") {
        return isSafeFile(spec.jar) ? { type: "jar", jar: spec.jar } : null;
    }
    if (spec.type === "argfile") {
        return isSafeFile(spec.unix) && isSafeFile(spec.windows)
            ? { type: "argfile", unix: spec.unix, windows: spec.windows }
            : null;
    }
    return null;
}

function isSafeFile(value: unknown): value is string {
    return typeof value === "string" && value !== "" && isListableDirArg(value);
}

/** The file that must exist before the server can start on this OS. */
export function launchEntryFile(spec: LaunchSpec, windows: boolean): string {
    if (spec.type === "jar") return spec.jar;
    return windows ? spec.windows : spec.unix;
}

/** java argv (without the java binary) for a server launch. */
export function javaLaunchArgs(spec: LaunchSpec, ramGb: number, windows: boolean): string[] {
    const memory = [`-Xmx${ramGb}G`, `-Xms${ramGb}G`];
    if (spec.type === "jar") return [...memory, "-jar", spec.jar, "nogui"];
    // java expands @file itself; no shell is involved
    return [...memory, `@${windows ? spec.windows : spec.unix}`, "nogui"];
}

/** Where an installer-based software may leave its launch entry point. */
export interface InstallerLaunchCandidates {
    /** directory holding unix_args.txt and win_args.txt, relative to the install root */
    argfileDir?: string;
    /** runnable jars to accept when no argument files exist, most specific first */
    jars?: string[];
}

/**
 * Reads the launch entry point from what an installer produced. Argument
 * files win over jars: Forge 1.17+ also leaves a shim jar, but its own
 * run scripts launch through the argument files. Null when the installer
 * left nothing runnable, which the install must treat as a failure.
 */
export async function detectInstallerLaunch(
    candidates: InstallerLaunchCandidates,
    exists: (relativePath: string) => Promise<boolean>,
): Promise<LaunchSpec | null> {
    if (candidates.argfileDir) {
        const unix = `${candidates.argfileDir}/unix_args.txt`;
        const windows = `${candidates.argfileDir}/win_args.txt`;
        if ((await exists(unix)) && (await exists(windows))) {
            return { type: "argfile", unix, windows };
        }
    }
    for (const jar of candidates.jars ?? []) {
        if (await exists(jar)) return { type: "jar", jar };
    }
    return null;
}
