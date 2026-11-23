import { describe, expect, test } from "bun:test";
import {
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
});
