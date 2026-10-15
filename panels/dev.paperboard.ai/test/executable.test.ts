// Finding an installed agent without a shell: PATH first, then the per-user
// folders installers use, and npm's Windows shims run through node.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, scriptFromCmdShim, searchDirs } from "../src/service/executable";

let home: string;
let onPath: string;

beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-exec-"));
    onPath = path.join(home, "on-path");
    fs.mkdirSync(onPath);
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    const tool = (dir: string, name: string, mode = 0o755) => fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode });
    tool(onPath, "agent-a");
    tool(path.join(home, ".local", "bin"), "agent-b");
    tool(onPath, "not-runnable", 0o644);
    for (const v of ["v18.0.0", "v22.1.0", "v20.5.0"]) fs.mkdirSync(path.join(home, ".nvm", "versions", "node", v, "bin"), { recursive: true });
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const env = () => ({ platform: "linux" as const, pathEnv: onPath, home });

describe("finding an agent", () => {
    it("finds a command on PATH, then in per-user folders, and puts its folder first on PATH", async () => {
        expect(await findExecutable("agent-a", ["--acp"], env())).toEqual({ command: path.join(onPath, "agent-a"), args: ["--acp"], pathEnv: `${onPath}:${onPath}` });
        expect((await findExecutable("agent-b", [], env()))?.command).toBe(path.join(home, ".local", "bin", "agent-b"));
    });

    it("skips files that are not executable and reports a missing command as null", async () => {
        expect(await findExecutable("not-runnable", [], env())).toBeNull();
        expect(await findExecutable("nowhere", [], env())).toBeNull();
    });

    it("takes an absolute path as is and refuses a relative one", async () => {
        expect((await findExecutable(path.join(onPath, "agent-a"), [], env()))?.command).toBe(path.join(onPath, "agent-a"));
        await expect(findExecutable("./agent-a", [], env())).rejects.toThrow("must be a command name or an absolute path");
    });

    it("searches nvm's node versions newest first", async () => {
        const dirs = await searchDirs(env());
        const nvm = dirs.filter((d) => d.includes(".nvm"));
        expect(nvm.map((d) => path.basename(path.dirname(d)))).toEqual(["v22.1.0", "v20.5.0", "v18.0.0"]);
    });

    it("reads the script out of npm's Windows shim", () => {
        const shim = '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@zed-industries\\codex-acp\\bin\\codex-acp.js" %*\r\n';
        expect(scriptFromCmdShim(shim, "C:\\npm")).toBe("C:\\npm\\node_modules\\@zed-industries\\codex-acp\\bin\\codex-acp.js");
    });
});

// Model Windows filesystem names on every CI OS; actual Windows spawning remains an OS check.
it("resolves absolute npm shims and already-suffixed Windows commands", async () => {
    const files = new Map([
        ["C:\\npm\\agent.cmd", '\"%dp0%\\node_modules\\agent\\main.js\"'],
        ["C:\\npm\\node.exe", ""],
        ["C:\\npm\\agent.exe", ""],
    ]);
    const stat = spyOn(fs.promises, "stat").mockImplementation(async (file: any) => {
        if (files.has(String(file))) return { isFile: () => true } as any;
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const read = spyOn(fs.promises, "readFile").mockImplementation(async (file: any) => files.get(String(file)) as any);
    const windows = { platform: "win32" as const, pathEnv: "C:\\npm", home: "C:\\home", pathExt: ".EXE;.CMD" };
    try {
        expect(await findExecutable("C:\\npm\\agent.cmd", ["--acp"], windows)).toMatchObject({
            command: "C:\\npm\\node.exe", args: ["C:\\npm\\node_modules\\agent\\main.js", "--acp"],
        });
        expect((await findExecutable("agent.exe", [], windows))?.command).toBe("C:\\npm\\agent.exe");
    } finally {
        stat.mockRestore();
        read.mockRestore();
    }
});
