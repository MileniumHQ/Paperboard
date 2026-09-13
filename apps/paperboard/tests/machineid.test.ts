import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { paperCraneMachineId } from "../papercrane/discovery";

let tmp = "";
let savedEnv: string | undefined;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "machineid-test-"));
    savedEnv = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = tmp;
});

afterAll(() => {
    if (savedEnv === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("paperCraneMachineId", () => {
    it("generates once and persists across calls", () => {
        const first = paperCraneMachineId();
        expect(first.length).toBeGreaterThanOrEqual(8);
        const second = paperCraneMachineId();
        expect(second).toBe(first);
        expect(
            fs.existsSync(path.join(tmp, "local", "machine-id.json")),
        ).toBe(true);
    });

    it("does not depend on the hostname", () => {
        const id = paperCraneMachineId();
        expect(id).not.toContain(os.hostname());
    });
});
