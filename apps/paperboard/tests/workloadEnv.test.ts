// A workload's PWD names its own working directory, not the daemon's: a
// program that trusts PWD over getcwd (`opencode run` does) otherwise works in
// whatever directory the daemon was started from.
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EmbeddedSupervisor } from "../papercrane/embeddedSupervisor";
import { workloadEnv } from "../papercrane/workloadEnv";

const dirs: string[] = [];
const embedded: EmbeddedSupervisor[] = [];
afterEach(() => {
    for (const workload of embedded.splice(0)) workload.kill("SIGKILL");
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a workload's environment", () => {
    it("names the workload's directory as PWD, whatever the daemon's was", () => {
        const before = { PWD: process.env.PWD, OLDPWD: process.env.OLDPWD };
        process.env.PWD = "/somewhere/the/daemon/started";
        process.env.OLDPWD = "/before/that";
        try {
            const env = workloadEnv({ A: "1" }, "/work/dir", { TERM: "xterm-256color" });
            expect(env.PWD).toBe("/work/dir");
            expect(env.OLDPWD).toBeUndefined();
            expect(env.A).toBe("1");
            expect(env.TERM).toBe("xterm-256color");
        } finally {
            for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
        }
    });

    it("reaches a child the embedded supervisor starts", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workload-env-"));
        dirs.push(dir);
        const work = fs.realpathSync(dir);
        const out = path.join(work, "env.json");
        const workload = new EmbeddedSupervisor("dev.test.pwd.embedded", {
            id: "dev.test.pwd.embedded",
            type: "child_process",
            command: process.execPath,
            args: ["-e", `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ pwd: process.env.PWD ?? null }))`],
            cwd: work,
        });
        embedded.push(workload);
        const exited = new Promise<number>((ok) => workload.on("exit", ok));
        expect(await workload.connect()).toBe(true);
        expect(await exited).toBe(0);
        expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual({ pwd: work });
    }, 30_000);
});
