import * as nodeFs from "node:fs";

const GB = 1024 ** 3;
/** What a JVM takes beyond its heap (code, threads, buffers), as measured on a 2 GB Paper server: about 0.7 GB. */
export const JVM_OVERHEAD_GB = 0.75;
/** What the system and Paperboard need beside the server. */
export const SYSTEM_RESERVE_GB = 0.5;

const gb = (n: number) => `${Math.round(n * 10) / 10} GB`;

/**
 * Whether a Java heap fits the computer's memory. A heap as large as the
 * memory can never run: the server sets all of it aside as it starts. One
 * that leaves too little for the JVM and the system starts, and is the first
 * program the system ends when memory runs out.
 */
export function heapFit(heapGb: number, totalBytes: number): { refuse: string } | { warn: string } | null {
    const total = totalBytes / GB;
    if (heapGb + JVM_OVERHEAD_GB > total)
        return { refuse: `Memory Allocation is ${gb(heapGb)}, but this computer has ${gb(total)} of memory and Java needs about ${gb(JVM_OVERHEAD_GB)} more than it. Lower Memory Allocation in Options to ${gb(Math.max(0.5, Math.floor((total - JVM_OVERHEAD_GB - SYSTEM_RESERVE_GB) * 10) / 10))} or less.` };
    if (heapGb + JVM_OVERHEAD_GB + SYSTEM_RESERVE_GB > total)
        return { warn: `[Server] Memory Allocation is ${gb(heapGb)} of this computer's ${gb(total)}. With Java's own share that leaves too little for everything else, so the system may end the server when memory runs out. Lower Memory Allocation in Options if it stops on its own.` };
    return null;
}

/**
 * How many programs the system has ended for running out of memory in this
 * service's control group and the ones under it, where the game servers it
 * starts run. null where the system keeps no such count (not Linux, or no
 * cgroup v2): a crash there is told without the cause.
 */
export function oomKillCount(root = "/sys/fs/cgroup", self = "/proc/self/cgroup"): number | null {
    if (process.platform !== "linux") return null;
    let group: string | undefined;
    try {
        group = /^0::(.*)$/m.exec(nodeFs.readFileSync(self, "utf8"))?.[1];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
    if (group === undefined) return null;
    let events: string;
    try {
        events = nodeFs.readFileSync(`${root}${group === "/" ? "" : group}/memory.events`, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
    const count = /^oom_kill (\d+)$/m.exec(events)?.[1];
    if (count === undefined) throw new Error("The system's memory events have no oom_kill count");
    return Number(count);
}
