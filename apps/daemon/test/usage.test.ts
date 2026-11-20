import { describe, expect, test } from "bun:test";
import {
	attribute,
	parseLinuxBootTime,
	parseLinuxStat,
	parsePsTable,
	parseWindowsTable,
	processTree,
	type ProcessSample,
	type ProcessTable,
} from "../src/system/usage";

const table = (rows: Record<number, Pick<ProcessSample, "ppid" | "startedAt">>): ProcessTable =>
	new Map(Object.entries(rows).map(([pid, row]) => [Number(pid), { ...row, rssBytes: 0, cpuMs: 0 }]));

// Home's CPU and Memory attribution, and anything else that ends or counts
// "what a process started", must never take in someone else's program.
describe("process trees", () => {
	// Windows leaves a dead parent's pid on its children and later gives
	// that pid to a new process: the old daemon (pid 100) is gone, its
	// detached supervisor (200) and that supervisor's game server (300) run
	// on, and a new process now holds 100
	const reused = table({
		100: { ppid: 1, startedAt: 9_000 },
		200: { ppid: 100, startedAt: 2_000 },
		300: { ppid: 200, startedAt: 2_500 },
		400: { ppid: 100, startedAt: 9_500 },
	});

	test("a process that took a dead parent's pid gets none of that parent's children", () => {
		expect(processTree(reused, [100]).sort()).toEqual([100, 400]);
		// the orphans are still one tree of their own
		expect(processTree(reused, [200]).sort()).toEqual([200, 300]);
	});

	test("Home charges the orphans to no one, and the new process its own child", () => {
		const owner = attribute(reused, { paperboard: [100], panels: new Map() });
		expect([...owner].sort()).toEqual([[100, "paperboard"], [400, "paperboard"]]);
	});

	test("a panel keeps its own subtree inside Paperboard's, and a missing root is no tree", () => {
		const live = table({
			10: { ppid: 1, startedAt: 1_000 },
			20: { ppid: 10, startedAt: 1_100 },
			30: { ppid: 20, startedAt: 1_200 },
			40: { ppid: 10, startedAt: 1_100 },
		});
		const owner = attribute(live, { paperboard: [10, 999], panels: new Map([["dev.test.panel", [20]]]) });
		expect(Object.fromEntries(owner)).toEqual({ 10: "paperboard", 20: "dev.test.panel", 30: "dev.test.panel", 40: "paperboard" });
		expect(processTree(live, [999])).toEqual([]);
	});
});

describe("process tables carry each start time", () => {
	test("Linux: starttime ticks after the boot time", () => {
		const boot = parseLinuxBootTime("cpu  1 2 3\nbtime 1700000000\nprocesses 5\n");
		expect(boot).toBe(1_700_000_000_000);
		// a command name with spaces and parentheses; starttime (field 22) is 4200 ticks
		const line = "1234 (my (odd) cmd) S 77 1234 1234 0 -1 4194560 100 0 0 0 30 20 0 0 20 0 1 0 4200 1000000 25 18446744073709551615";
		expect(parseLinuxStat(line, 4096, boot)).toEqual({ ppid: 77, startedAt: 1_700_000_042_000, rssBytes: 25 * 4096, cpuMs: 500 });
		expect(() => parseLinuxBootTime("cpu 1 2 3\n")).toThrow("btime");
	});

	test("macOS: lstart, local time, a one-digit day padded", () => {
		const out = "  321     1   2048   0:01.50 Wed Nov  5 09:11:44 2026\n  bad line\n";
		expect(parsePsTable(out)).toEqual(new Map([[321, { ppid: 1, startedAt: new Date(2026, 10, 5, 9, 11, 44).getTime(), rssBytes: 2048 * 1024, cpuMs: 1500 }]]));
	});

	test("Windows: CreationDate as a FILETIME, and 0 for the System process", () => {
		// 2026-11-20T00:00:00Z as a FILETIME
		const created = (Date.UTC(2026, 10, 20) + 11_644_473_600_000) * 10_000;
		const parsed = parseWindowsTable(`4 0 1000 50000 0\r\n500 4 8192 20000 ${created}\r\n`);
		expect(parsed.get(4)).toEqual({ ppid: 0, startedAt: 0, rssBytes: 1000, cpuMs: 5 });
		expect(parsed.get(500)).toEqual({ ppid: 4, startedAt: Date.UTC(2026, 10, 20), rssBytes: 8192, cpuMs: 2 });
	});
});
