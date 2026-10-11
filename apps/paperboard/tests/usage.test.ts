// system:usage: CPU and memory split by owner for Home's widgets. A panel
// owns its service and the workloads it created, with their descendants;
// Paperboard owns the daemon's tree minus those; everything else is other.
import { describe, expect, it } from "bun:test";
import { handleSystem } from "../papercrane/rpc/system";
import {
    attribute,
    computeUsage,
    parseLinuxStat,
    parsePsTable,
    parsePsTime,
    parseWindowsTable,
    readProcessTable,
    type ProcessTable,
    type Snapshot,
    UsageSampler,
} from "../papercrane/usage";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

function table(rows: Array<[pid: number, ppid: number, rssMiB: number, cpuMs: number]>): ProcessTable {
    return new Map(rows.map(([pid, ppid, rss, cpuMs]) => [pid, { ppid, rssBytes: rss * MiB, cpuMs }]));
}

// daemon 100 spawned panel services 200 (a) and 300 (b); a's service runs
// java 201; the host's terminal supervisor 400 is detached; 500 is a browser
const processes = (cpu: Record<number, number> = {}) =>
    table([
        [1, 0, 10, 0],
        [100, 1, 80, cpu[100] ?? 0],
        [200, 100, 40, cpu[200] ?? 0],
        [201, 200, 900, cpu[201] ?? 0],
        [300, 100, 30, cpu[300] ?? 0],
        [400, 1, 5, cpu[400] ?? 0],
        [500, 1, 600, cpu[500] ?? 0],
    ]);
const roots = () => ({
    paperboard: [100, 400],
    panels: new Map([
        ["dev.paperboard.gameserver", [200]],
        ["b", [300]],
    ]),
});

describe("usage attribution", () => {
    it("gives a panel its service and descendants even though the daemon spawned them", () => {
        const owner = attribute(processes(), roots());
        expect(owner.get(200)).toBe("dev.paperboard.gameserver");
        expect(owner.get(201)).toBe("dev.paperboard.gameserver");
        expect(owner.get(300)).toBe("b");
        expect(owner.get(100)).toBe("paperboard");
        expect(owner.get(400)).toBe("paperboard");
        expect(owner.has(500)).toBe(false);
        expect(owner.has(1)).toBe(false);
    });

    it("ignores roots that are no longer running", () => {
        const owner = attribute(processes(), { paperboard: [100], panels: new Map([["gone", [999]]]) });
        expect([...owner.values()]).not.toContain("gone");
    });
});

describe("usage report", () => {
    const snapshot = (at: number, cpu: Record<number, number>, busyMs: number, totalMs: number): Snapshot => ({
        at,
        table: processes(cpu),
        cpu: { busyMs, totalMs },
        cores: 4,
        totalBytes: 16 * GiB,
        availableBytes: 10 * GiB,
    });

    it("has no CPU figures from a single sample", () => {
        const report = computeUsage(null, snapshot(0, {}, 0, 0), roots());
        expect(report.cpu).toBeNull();
        expect(report.groups.every((g) => g.cpuPercent === null)).toBe(true);
    });

    it("splits memory by owner and leaves the rest of what's in use to other", () => {
        const report = computeUsage(null, snapshot(0, {}, 0, 0), roots());
        const bytes = Object.fromEntries(report.groups.map((g) => [g.id, g.memoryBytes / MiB]));
        expect(bytes).toEqual({ paperboard: 85, "dev.paperboard.gameserver": 940, b: 30 });
        expect(report.memory.otherBytes).toBe(6 * GiB - 1055 * MiB);
    });

    it("measures CPU as a share of every core over the interval", () => {
        // one second on 4 cores = 4000 core-ms; the machine was 50% busy
        const before = snapshot(0, { 201: 1000, 100: 0 }, 0, 0);
        const after = snapshot(1000, { 201: 2000, 100: 200 }, 2000, 4000);
        const report = computeUsage(before, after, roots());
        const cpu = Object.fromEntries(report.groups.map((g) => [g.id, g.cpuPercent]));
        expect(cpu["dev.paperboard.gameserver"]).toBe(25);
        expect(cpu.paperboard).toBe(5);
        expect(report.cpu).toEqual({ cores: 4, otherPercent: 20, idlePercent: 50 });
    });

    it("never reports a negative remainder when resident sets overlap", () => {
        const snap = snapshot(0, {}, 0, 0);
        snap.availableBytes = 16 * GiB - 100 * MiB;
        expect(computeUsage(null, snap, roots()).memory.otherBytes).toBe(0);
    });
});

describe("usage sampler", () => {
    it("takes a baseline first, then shares one sample between concurrent callers", async () => {
        let reads = 0;
        let clock = 0;
        const sampler = new UsageSampler({
            readTable: async () => {
                reads++;
                return processes();
            },
            readCpu: () => ({ busyMs: clock, totalMs: clock * 2 }),
            cores: () => 4,
            totalBytes: () => 16 * GiB,
            availableBytes: () => 8 * GiB,
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
        });
        const [a, b] = await Promise.all([sampler.sample(roots), sampler.sample(roots)]);
        expect(a).toBe(b);
        expect(reads).toBe(2);
        expect(a.cpu).not.toBeNull();
        // within the reuse window the same report comes back without a read
        clock += 200;
        expect(await sampler.sample(roots)).toBe(a);
        expect(reads).toBe(2);
        // after it, one new read against the previous sample
        clock += 2000;
        await sampler.sample(roots);
        expect(reads).toBe(3);
    });
});

describe("process table parsers", () => {
    it("reads /proc stat lines whose command name contains parentheses and spaces", () => {
        const line = "4242 (my (odd) name) S 17 4242 4242 0 -1 4194304 100 0 0 0 250 50 0 0 20 0 1 0 123 1000000 512 18446744073709551615";
        expect(parseLinuxStat(line, 4096)).toEqual({ ppid: 17, rssBytes: 512 * 4096, cpuMs: 3000 });
        expect(parseLinuxStat("garbage", 4096)).toBeNull();
    });

    it("reads macOS ps times and rows", () => {
        expect(parsePsTime("0:01.50")).toBe(1500);
        expect(parsePsTime("1:02:03.00")).toBe(3_723_000);
        expect(parsePsTime("2-00:00:01")).toBe(172_801_000);
        expect(parsePsTime("nope")).toBeNull();
        const parsed = parsePsTable("  1     0  1024   0:10.00\n 77     1   512   0:00.25\n");
        expect(parsed.get(77)).toEqual({ ppid: 1, rssBytes: 512 * 1024, cpuMs: 250 });
    });

    it("reads Windows query rows", () => {
        const parsed = parseWindowsTable("4 0 1048576 50000000\r\n8 4 2048 10000\r\n");
        expect(parsed.get(4)).toEqual({ ppid: 0, rssBytes: 1048576, cpuMs: 5000 });
        expect(parsed.get(8)?.cpuMs).toBe(1);
    });

    it.skipIf(process.platform !== "linux")("reads this process from the real /proc", async () => {
        const real = await readProcessTable();
        const self = real.get(process.pid);
        expect(self?.ppid).toBe(process.ppid);
        expect(self?.rssBytes ?? 0).toBeGreaterThan(MiB);
    });
});

describe("system:usage claim boundary", () => {
    it("refuses a panel's scoped token", async () => {
        const replies: { error?: string; code?: string }[] = [];
        const ctx = {
            callerPanelId: () => "dev.paperboard.gameserver",
            reply: (_id: unknown, _result: unknown, error?: string, code?: string) => replies.push({ error, code }),
        };
        await handleSystem("system:usage", 1, {}, ctx as never);
        expect(replies[0].code).toBe("FORBIDDEN");
    });
});
