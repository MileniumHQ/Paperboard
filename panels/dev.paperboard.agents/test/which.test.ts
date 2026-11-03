import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../src/service/which";

// npm's own npx.cmd, as Node.js installs it on Windows
const NPX_CMD = [
    ":: Created by npm, please don't edit manually.",
    "@ECHO OFF",
    "SETLOCAL",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'IF NOT EXIST "%NODE_EXE%" (',
    '  SET "NODE_EXE=node"',
    ")",
    'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
    'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
    "FOR /F \"delims=\" %%F IN ('CALL \"%NODE_EXE%\" \"%NPM_PREFIX_JS%\"') DO (",
    '  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"',
    ")",
    '"%NODE_EXE%" "%NPX_CLI_JS%" %*',
    "",
].join("\r\n");
// the shim npm writes for a globally installed package
const PACKAGE_CMD = '@ECHO off\r\nGOTO start\r\n:start\r\n"%_prog%"  "%dp0%\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js" %*\r\n';

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-which-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function put(rel: string, text: string, mode = 0o644) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { mode });
    return file;
}

describe("finding a tool server's program on Windows", () => {
    const windows = (pathEnv: string) => ({ platform: "win32" as const, pathEnv, pathExt: ".COM;.EXE;.BAT;.CMD" });

    test("npx is npm's npx.cmd, started as node with npx-cli.js", () => {
        const nodejs = path.join(dir, "nodejs");
        const node = put("nodejs/node.exe", "");
        put("nodejs/npx.cmd", NPX_CMD);
        expect(findProgram("npx", ["-y", "@modelcontextprotocol/server-memory"], windows(nodejs))).toEqual({
            command: node,
            args: [path.join(nodejs, "node_modules", "npm", "bin", "npx-cli.js"), "-y", "@modelcontextprotocol/server-memory"],
        });
    });

    test("a globally installed server's shim runs its script with the node on PATH", () => {
        const npm = path.join(dir, "npm");
        const nodejs = path.join(dir, "nodejs");
        put("npm/mcp-server-filesystem.cmd", PACKAGE_CMD);
        const node = put("nodejs/node.exe", "");
        expect(findProgram("mcp-server-filesystem", ["C:\\Users\\pip"], windows(`${npm};${nodejs}`))).toEqual({
            command: node,
            args: [path.join(npm, "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js"), "C:\\Users\\pip"],
        });
    });

    test("a program is found by its .exe and started as it is", () => {
        const bin = path.join(dir, "uv");
        const uvx = put("uv/uvx.exe", "");
        expect(findProgram("uvx", ["mcp-server-git"], windows(bin))).toEqual({ command: uvx, args: ["mcp-server-git"] });
    });

    test("a batch file that isn't an npm shim is refused, saying why", () => {
        const bin = path.join(dir, "bin");
        put("bin/serve.bat", "@echo off\r\npython serve.py %*\r\n");
        expect(() => findProgram("serve", [], windows(bin))).toThrow("is a batch file");
    });

    test("a shim with no Node.js to run it says so", () => {
        const npm = path.join(dir, "npm");
        put("npm/mcp-server-filesystem.cmd", PACKAGE_CMD);
        expect(() => findProgram("mcp-server-filesystem", [], windows(npm))).toThrow("needs Node.js");
    });
});

describe("finding a tool server's program elsewhere", () => {
    test("only a runnable file on PATH counts", () => {
        const bin = path.join(dir, "bin");
        put("bin/notes", "");
        const env = { platform: "linux" as const, pathEnv: bin };
        expect(findProgram("notes", [], env)).toBeNull();
        fs.chmodSync(path.join(bin, "notes"), 0o755);
        expect(findProgram("notes", ["--stdio"], env)).toEqual({ command: path.join(bin, "notes"), args: ["--stdio"] });
    });

    test("a full path is started as it is, and a missing one isn't installed", () => {
        const file = put("My Servers/notes", "", 0o755);
        expect(findProgram(file, [], { platform: "darwin", pathEnv: "" })).toEqual({ command: file, args: [] });
        expect(findProgram(path.join(dir, "gone"), [], { platform: "darwin", pathEnv: "" })).toBeNull();
    });
});
