import { isListableDirArg } from "../core/dirs";

// How the server process is started, recorded at install time from the
// files the install actually produced. Lifecycle launches from this record
// instead of assuming `java -jar server.jar`.
//
//   jar      java -Xmx… <tuning> -jar <jar> nogui
//            vanilla, Paper, Fabric's launcher, Forge up to 1.16.5
//   argfile  java -Xmx… <tuning> @<args file> nogui
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

/** What the JVM is tuned for: the heap, the runtime's major version and what the computer offers. */
export interface JvmTuning {
    /** heap size, in steps of 0.1 GB */
    ramGb: number;
    /** major version of the Java runtime that runs the server, such as 21 */
    javaMajor: number;
    /** Linux with transparent huge pages available (enabled "always" or "madvise") */
    hugePages: boolean;
}

/**
 * Aikar's G1 flags (https://docs.papermc.io/paper/aikars-flags), the
 * standard tuning for Minecraft servers: short, predictable collection
 * pauses for a heap that is fixed in size and touched up front. Heaps over
 * 12 GB get the larger young generation and regions the guide gives them.
 * On top: transparent huge pages where Linux offers them (fewer TLB misses
 * on a multi-gigabyte heap), and on Java 25+ compact object headers, which
 * shrink every object by 4 bytes, so the same world takes less of the heap.
 */
export function jvmFlags({ ramGb, javaMajor, hugePages }: JvmTuning): string[] {
    const large = ramGb > 12;
    return [
        "-XX:+UseG1GC",
        "-XX:+ParallelRefProcEnabled",
        "-XX:MaxGCPauseMillis=200",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+DisableExplicitGC",
        "-XX:+AlwaysPreTouch",
        `-XX:G1NewSizePercent=${large ? 40 : 30}`,
        `-XX:G1MaxNewSizePercent=${large ? 50 : 40}`,
        `-XX:G1HeapRegionSize=${large ? 16 : 8}M`,
        `-XX:G1ReservePercent=${large ? 15 : 20}`,
        "-XX:G1HeapWastePercent=5",
        "-XX:G1MixedGCCountTarget=4",
        `-XX:InitiatingHeapOccupancyPercent=${large ? 20 : 15}`,
        "-XX:G1MixedGCLiveThresholdPercent=90",
        "-XX:G1RSetUpdatingPauseTimePercent=5",
        "-XX:SurvivorRatio=32",
        "-XX:+PerfDisableSharedMem",
        "-XX:MaxTenuringThreshold=1",
        ...(hugePages ? ["-XX:+UseTransparentHugePages"] : []),
        ...(javaMajor >= 25 ? ["-XX:+UseCompactObjectHeaders"] : []),
    ];
}

/** java argv (without the java binary) for a server launch. */
export function javaLaunchArgs(spec: LaunchSpec, tuning: JvmTuning, windows: boolean): string[] {
    // in megabytes: java takes whole units, and 0.1 GB steps aren't whole gigabytes
    const heap = `${Math.round(tuning.ramGb * 1024)}M`;
    const jvm = [`-Xmx${heap}`, `-Xms${heap}`, ...jvmFlags(tuning)];
    if (spec.type === "jar") return [...jvm, "-jar", spec.jar, "nogui"];
    // java expands @file itself; no shell is involved
    return [...jvm, `@${windows ? spec.windows : spec.unix}`, "nogui"];
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
