// Resource use for Home's CPU and Memory widgets: how much of this computer
// each panel uses, how much Paperboard itself uses, how much everything else
// uses, and how much is free. Attribution follows ownership, never process
// names: a panel owns its service and the supervised workloads the ledger
// says it created, with all of their descendants.
//
// Read-only probes: /proc on Linux, fixed-argv `ps` on macOS and a static
// PowerShell query on Windows, all without a shell and with timeouts.
import { execFile } from "child_process";
import fs from "fs";
import os from "os";

export interface ProcessSample {
    ppid: number;
    rssBytes: number;
    /** user + system CPU time since the process started */
    cpuMs: number;
}
export type ProcessTable = Map<number, ProcessSample>;

/** Processes each owner started; their descendants come with them. */
export interface UsageRoots {
    paperboard: number[];
    panels: Map<string, number[]>;
}

export interface UsageGroup {
    /** "paperboard", or a panel id */
    id: string;
    kind: "paperboard" | "panel";
    memoryBytes: number;
    /** share of the whole computer (every core), 0-100; null until a second sample */
    cpuPercent: number | null;
}

export interface UsageReport {
    sampledAt: number;
    memory: { totalBytes: number; availableBytes: number; otherBytes: number };
    /** null when no CPU interval could be measured */
    cpu: { cores: number; idlePercent: number; otherPercent: number } | null;
    groups: UsageGroup[];
}

export interface CpuTimes {
    busyMs: number;
    totalMs: number;
}

export interface Snapshot {
    at: number;
    table: ProcessTable;
    cpu: CpuTimes;
    cores: number;
    totalBytes: number;
    availableBytes: number;
}

const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_OUTPUT = 16 * 1024 * 1024;
const PROC_READ_CONCURRENCY = 64;
/** A report this fresh is shared: any number of widgets cost one sample. */
const REUSE_MS = 1_000;
/** CPU use is a rate; a first look waits this long for a second sample. */
const BASELINE_MS = 500;
/** An older baseline would average over minutes; it is taken afresh. */
const STALE_BASELINE_MS = 10_000;
// Linux reports CPU time in clock ticks; USER_HZ is 100 on every
// architecture the kernel exposes to userspace.
const LINUX_TICKS_PER_SECOND = 100;

// ─── Process tables ──────────────────────────────────────────────────────────

type ExecFn = (command: string, args: string[]) => Promise<string>;

const defaultExec: ExecFn = (command, args) =>
    new Promise((resolve, reject) => {
        execFile(command, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_PROBE_OUTPUT, windowsHide: true }, (err, stdout) => {
            if (err) reject(err);
            else resolve(String(stdout));
        });
    });

/** /proc/<pid>/stat; null when the line is not one. */
export function parseLinuxStat(line: string, pageSize: number): ProcessSample | null {
    // the command name sits in parentheses and may itself contain them
    const close = line.lastIndexOf(")");
    if (close < 0) return null;
    const fields = line.slice(close + 2).split(" ");
    // fields[0] is state (stat field 3): ppid is 4, utime 14, stime 15, rss 24
    const ppid = Number(fields[1]);
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    const rssPages = Number(fields[21]);
    if (![ppid, utime, stime, rssPages].every(Number.isFinite)) return null;
    return {
        ppid,
        rssBytes: Math.max(0, rssPages) * pageSize,
        cpuMs: ((utime + stime) * 1000) / LINUX_TICKS_PER_SECOND,
    };
}

/** `ps -o time` on macOS: [[dd-]hh:]mm:ss.ss */
export function parsePsTime(value: string): number | null {
    const [days, clock] = value.includes("-") ? value.split("-") : ["0", value];
    const parts = clock.split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || !parts.every(Number.isFinite) || !Number.isFinite(Number(days))) return null;
    const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
    return Math.round(((Number(days) * 24 + h) * 3600 + m * 60 + s) * 1000);
}

/** `ps -axo pid=,ppid=,rss=,time=`: rss in KiB */
export function parsePsTable(output: string): ProcessTable {
    const table: ProcessTable = new Map();
    for (const line of output.split("\n")) {
        const [pid, ppid, rss, time] = line.trim().split(/\s+/);
        const cpuMs = time ? parsePsTime(time) : null;
        if (!pid || cpuMs === null || !Number.isInteger(Number(pid))) continue;
        table.set(Number(pid), { ppid: Number(ppid), rssBytes: Number(rss) * 1024, cpuMs });
    }
    return table;
}

/** "pid ppid workingSetBytes cpu100ns" lines from the Windows query */
export function parseWindowsTable(output: string): ProcessTable {
    const table: ProcessTable = new Map();
    for (const line of output.split("\n")) {
        const [pid, ppid, ws, cpu] = line.trim().split(/\s+/).map(Number);
        if (!Number.isInteger(pid) || ![ppid, ws, cpu].every(Number.isFinite)) continue;
        table.set(pid, { ppid, rssBytes: ws, cpuMs: cpu / 10_000 });
    }
    return table;
}

const WINDOWS_QUERY =
    "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) $($_.KernelModeTime + $_.UserModeTime)\" }";

let linuxPageSize: Promise<number> | null = null;

async function readLinuxTable(exec: ExecFn): Promise<ProcessTable> {
    linuxPageSize ??= exec("getconf", ["PAGESIZE"]).then((out) => {
        const size = Number(out.trim());
        if (!Number.isInteger(size) || size <= 0) throw new Error(`getconf PAGESIZE answered "${out.trim()}"`);
        return size;
    });
    const pageSize = await linuxPageSize.catch((err) => {
        linuxPageSize = null;
        throw err;
    });
    const pids = (await fs.promises.readdir("/proc")).filter((name) => /^\d+$/.test(name));
    const table: ProcessTable = new Map();
    let next = 0;
    const worker = async () => {
        while (next < pids.length) {
            const pid = pids[next++];
            let line: string;
            try {
                line = await fs.promises.readFile(`/proc/${pid}/stat`, "utf8");
            } catch (err) {
                // a process that exited after the listing is simply gone
                const code = (err as NodeJS.ErrnoException).code;
                if (code === "ENOENT" || code === "ESRCH") continue;
                throw err;
            }
            const sample = parseLinuxStat(line, pageSize);
            if (sample) table.set(Number(pid), sample);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PROC_READ_CONCURRENCY, pids.length) }, worker));
    return table;
}

export async function readProcessTable(platform = process.platform, exec: ExecFn = defaultExec): Promise<ProcessTable> {
    switch (platform) {
        case "linux":
            return readLinuxTable(exec);
        case "darwin":
            return parsePsTable(await exec("ps", ["-axo", "pid=,ppid=,rss=,time="]));
        case "win32":
            return parseWindowsTable(
                await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_QUERY]),
            );
        default:
            throw new Error(`Reading process usage is not supported on ${platform}`);
    }
}

export function readCpuTimes(): CpuTimes {
    let busyMs = 0;
    let totalMs = 0;
    for (const cpu of os.cpus()) {
        const { user, nice, sys, irq, idle } = cpu.times;
        busyMs += user + nice + sys + irq;
        totalMs += user + nice + sys + irq + idle;
    }
    return { busyMs, totalMs };
}

// ─── Attribution ─────────────────────────────────────────────────────────────

/**
 * Which owner each process belongs to: every panel's roots and their
 * descendants first, then Paperboard's (which skips subtrees a panel
 * already owns, such as panel services the daemon spawned).
 */
export function attribute(table: ProcessTable, roots: UsageRoots): Map<number, string> {
    const children = new Map<number, number[]>();
    for (const [pid, sample] of table) {
        if (sample.ppid === pid) continue;
        const list = children.get(sample.ppid);
        if (list) list.push(pid);
        else children.set(sample.ppid, [pid]);
    }
    const owner = new Map<number, string>();
    const claim = (id: string, starts: number[]) => {
        const stack = starts.filter((pid) => table.has(pid) && !owner.has(pid));
        while (stack.length > 0) {
            const pid = stack.pop() as number;
            if (owner.has(pid)) continue;
            owner.set(pid, id);
            for (const child of children.get(pid) ?? []) if (!owner.has(child)) stack.push(child);
        }
    };
    for (const id of [...roots.panels.keys()].sort()) claim(id, roots.panels.get(id) ?? []);
    claim("paperboard", roots.paperboard);
    return owner;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function computeUsage(previous: Snapshot | null, current: Snapshot, roots: UsageRoots): UsageReport {
    const owner = attribute(current.table, roots);
    const wallMs = previous ? current.at - previous.at : 0;
    const measured = previous !== null && wallMs > 0 && current.cpu.totalMs > previous.cpu.totalMs;

    const groups = new Map<string, UsageGroup>();
    const group = (id: string): UsageGroup => {
        let entry = groups.get(id);
        if (!entry) {
            entry = { id, kind: id === "paperboard" ? "paperboard" : "panel", memoryBytes: 0, cpuPercent: measured ? 0 : null };
            groups.set(id, entry);
        }
        return entry;
    };
    group("paperboard");
    for (const [pid, id] of owner) {
        const sample = current.table.get(pid) as ProcessSample;
        const entry = group(id);
        entry.memoryBytes += sample.rssBytes;
        if (measured && entry.cpuPercent !== null) {
            const before = previous?.table.get(pid);
            // a process born during the interval, or a reused pid, counts from now
            const spent = before && before.cpuMs <= sample.cpuMs ? sample.cpuMs - before.cpuMs : 0;
            entry.cpuPercent += (spent / (wallMs * current.cores)) * 100;
        }
    }
    const list = [...groups.values()];
    for (const entry of list) if (entry.cpuPercent !== null) entry.cpuPercent = clampPercent(entry.cpuPercent);

    const ours = list.reduce((sum, entry) => sum + entry.memoryBytes, 0);
    const used = Math.max(0, current.totalBytes - current.availableBytes);
    let cpu: UsageReport["cpu"] = null;
    if (measured && previous) {
        const busy = clampPercent(
            ((current.cpu.busyMs - previous.cpu.busyMs) / (current.cpu.totalMs - previous.cpu.totalMs)) * 100,
        );
        const oursCpu = list.reduce((sum, entry) => sum + (entry.cpuPercent ?? 0), 0);
        cpu = {
            cores: current.cores,
            otherPercent: clampPercent(busy - oursCpu),
            idlePercent: clampPercent(100 - Math.max(busy, oursCpu)),
        };
    }
    return {
        sampledAt: current.at,
        // shared pages can make the sum of resident sets exceed what is in
        // use; everything else is then reported as none, never negative
        memory: { totalBytes: current.totalBytes, availableBytes: current.availableBytes, otherBytes: Math.max(0, used - ours) },
        cpu,
        groups: list.filter((entry) => entry.kind === "paperboard" || entry.memoryBytes > 0),
    };
}

// ─── Sampler ─────────────────────────────────────────────────────────────────

export interface SamplerDeps {
    readTable: () => Promise<ProcessTable>;
    readCpu?: () => CpuTimes;
    cores?: () => number;
    totalBytes?: () => number;
    availableBytes?: () => number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/**
 * One sampler per daemon. Calls within REUSE_MS share a report, and calls
 * that arrive while a sample is being taken share that sample, so the cost
 * is set by time, not by how many widgets ask. It keeps one previous
 * snapshot and no timers.
 */
export class UsageSampler {
    private previous: Snapshot | null = null;
    private report: UsageReport | null = null;
    private inFlight: Promise<UsageReport> | null = null;
    private readonly deps: Required<SamplerDeps>;

    constructor(deps: SamplerDeps) {
        this.deps = {
            readCpu: readCpuTimes,
            cores: () => os.cpus().length || 1,
            totalBytes: () => os.totalmem(),
            availableBytes: () => os.freemem(),
            now: () => Date.now(),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            ...deps,
        };
    }

    public sample(roots: () => UsageRoots): Promise<UsageReport> {
        if (this.inFlight) return this.inFlight;
        if (this.report && this.deps.now() - this.report.sampledAt < REUSE_MS) return Promise.resolve(this.report);
        this.inFlight = this.take(roots).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async snapshot(): Promise<Snapshot> {
        const table = await this.deps.readTable();
        return {
            at: this.deps.now(),
            table,
            cpu: this.deps.readCpu(),
            cores: this.deps.cores(),
            totalBytes: this.deps.totalBytes(),
            availableBytes: this.deps.availableBytes(),
        };
    }

    private async take(roots: () => UsageRoots): Promise<UsageReport> {
        if (!this.previous || this.deps.now() - this.previous.at > STALE_BASELINE_MS) {
            this.previous = await this.snapshot();
            await this.deps.sleep(BASELINE_MS);
        }
        const current = await this.snapshot();
        const report = computeUsage(this.previous, current, roots());
        this.previous = current;
        this.report = report;
        return report;
    }
}

export const usageSampler = new UsageSampler({ readTable: () => readProcessTable() });
