// Whether a Java heap fits the computer, and the system's count of programs
// it ended for memory, read from cgroup files laid out as Linux lays them.
import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { heapFit, oomKillCount } from "../src/service/memory";

const GB = 1024 ** 3;
// a 4 GB VPS reports about 3.7 GB to programs
const vps = 3.72 * GB;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-memory-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("heapFit", () => {
    it("refuses a heap Java can't fit beside its own share", () => {
        // the default 4 GB, and the 3 GB the VPS was ended for on 2026-11-01
        for (const heap of [4, 3]) expect(heapFit(heap, vps)).toMatchObject({ refuse: expect.stringContaining("Lower Memory Allocation in Options to 2.4 GB or less") });
    });
    it("warns when too little is left for everything else", () => {
        expect(heapFit(2.6, vps)).toMatchObject({ warn: expect.stringContaining("the system may end the server") });
    });
    it("is quiet when the heap fits", () => {
        expect(heapFit(2, vps)).toBeNull();
        expect(heapFit(8, 32 * GB)).toBeNull();
    });
});

describe.if(process.platform === "linux")("oomKillCount", () => {
    const layout = (group: string, events: string | null) => {
        const dir = fs.mkdtempSync(path.join(root, "cg-"));
        fs.writeFileSync(path.join(dir, "self"), `0::${group}\n`);
        if (events !== null) {
            fs.mkdirSync(path.join(dir, "sys", group), { recursive: true });
            fs.writeFileSync(path.join(dir, "sys", group, "memory.events"), events);
        }
        return [path.join(dir, "sys"), path.join(dir, "self")] as const;
    };
    it("reads the count of the service's own group", () => {
        expect(oomKillCount(...layout("/system.slice/papercrane.service", "low 0\nhigh 0\nmax 0\noom 1\noom_kill 2\noom_group_kill 0\n"))).toBe(2);
    });
    it("is null where the system keeps no count", () => {
        expect(oomKillCount(...layout("/system.slice/papercrane.service", null))).toBeNull();
        expect(oomKillCount(path.join(root, "none"), path.join(root, "no-such-file"))).toBeNull();
    });
    it("a memory events file without the count is an error", () => {
        expect(() => oomKillCount(...layout("/a.scope", "low 0\n"))).toThrow("no oom_kill count");
    });
});
