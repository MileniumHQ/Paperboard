import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findProgram, type Launch } from "../../src/service/which";
import { tempDir } from "../support/host";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Start a Launch the way the daemon does, with no shell, and read what it printed. */
function run(launch: Launch): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((ok, fail) => {
        const child = spawn(launch.command, launch.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
        child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
        child.once("error", fail);
        child.once("close", (code) => ok({ code, stdout, stderr }));
    });
}

/** A runtime that runs a script like node does: this test's own, as a file at `to`. */
function runtimeAt(to: string) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.linkSync(process.execPath, to);
    } catch (e) {
        // another volume: a copy runs the same
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
        fs.copyFileSync(process.execPath, to);
    }
}

const PRINT_ARGV = "console.log(JSON.stringify({ script: require('path').basename(__filename), args: process.argv.slice(2) }));\n";

// Tool servers start on Windows.
describe("finding a tool server's program", () => {
    if (process.platform === "win32") {
        // npm's own npx.cmd, as npm writes it beside node.exe
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
            'IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (',
            '  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"',
            ")",
            '"%NODE_EXE%" "%NPX_CLI_JS%" %*',
        ].join("\r\n");
        // the shim npm writes for a globally installed package
        const GLOBAL_CMD = [
            "@ECHO off",
            "GOTO start",
            ":find_dp0",
            "SET dp0=%~dp0",
            "EXIT /b",
            ":start",
            "SETLOCAL",
            "CALL :find_dp0",
            'IF EXIST "%dp0%\\node.exe" (',
            '  SET "_prog=%dp0%\\node.exe"',
            ") ELSE (",
            '  SET "_prog=node"',
            "  SET PATHEXT=%PATHEXT:;.JS;=;%",
            ")",
            'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\files-server\\dist\\index.js" %*',
        ].join("\r\n");

        test("npx.cmd runs as the node.exe beside it with npx-cli.js", async () => {
            const root = tempDir("npx");
            dirs.push(root);
            const nodejs = path.join(root, "nodejs");
            runtimeAt(path.join(nodejs, "node.exe"));
            fs.writeFileSync(path.join(nodejs, "npx.cmd"), NPX_CMD);
            fs.mkdirSync(path.join(nodejs, "node_modules", "npm", "bin"), { recursive: true });
            fs.writeFileSync(path.join(nodejs, "node_modules", "npm", "bin", "npx-cli.js"), PRINT_ARGV);
            const launch = findProgram("npx", ["-y", "@modelcontextprotocol/server-everything"], { platform: "win32", pathEnv: `${path.join(root, "empty")};${nodejs}`, pathExt: ".COM;.EXE;.BAT;.CMD" });
            expect(launch).toEqual({ command: path.join(nodejs, "node.exe"), args: [path.join(nodejs, "node_modules", "npm", "bin", "npx-cli.js"), "-y", "@modelcontextprotocol/server-everything"] });
            const r = await run(launch!);
            expect(r.code).toBe(0);
            expect(JSON.parse(r.stdout)).toEqual({ script: "npx-cli.js", args: ["-y", "@modelcontextprotocol/server-everything"] });
        });

        test("a global package's .cmd shim runs its script with the node on PATH", async () => {
            const root = tempDir("shim");
            dirs.push(root);
            const nodejs = path.join(root, "nodejs");
            runtimeAt(path.join(nodejs, "node.exe"));
            const prefix = path.join(root, "npm-global");
            fs.mkdirSync(path.join(prefix, "node_modules", "files-server", "dist"), { recursive: true });
            fs.writeFileSync(path.join(prefix, "files-server.cmd"), GLOBAL_CMD);
            fs.writeFileSync(path.join(prefix, "node_modules", "files-server", "dist", "index.js"), PRINT_ARGV);
            const launch = findProgram("files-server", ["C:\\Users\\me\\Documents"], { platform: "win32", pathEnv: `${prefix};${nodejs}`, pathExt: ".COM;.EXE;.BAT;.CMD" });
            expect(launch).toEqual({ command: path.join(nodejs, "node.exe"), args: [path.join(prefix, "node_modules", "files-server", "dist", "index.js"), "C:\\Users\\me\\Documents"] });
            const r = await run(launch!);
            expect(r.code).toBe(0);
            expect(JSON.parse(r.stdout)).toEqual({ script: "index.js", args: ["C:\\Users\\me\\Documents"] });
        });

        test("a plain .exe is found by each PATHEXT ending and runs as is", async () => {
            const root = tempDir("exe");
            dirs.push(root);
            const bin = path.join(root, "bin");
            runtimeAt(path.join(bin, "tool-server.exe"));
            const launch = findProgram("tool-server", ["--version"], { platform: "win32", pathEnv: bin, pathExt: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD" });
            expect(launch).toEqual({ command: path.join(bin, "tool-server.exe"), args: ["--version"] });
            const r = await run(launch!);
            expect(r.code).toBe(0);
            expect(r.stdout.trim()).toBe(Bun.version);
        });
    } else {
        test("a program on PATH is found, skipping files that can't run, and runs as is", async () => {
            const root = tempDir("path");
            dirs.push(root);
            const first = path.join(root, "first");
            const second = path.join(root, "second");
            fs.mkdirSync(first);
            fs.mkdirSync(second);
            fs.writeFileSync(path.join(first, "tool-server"), "not a program");
            fs.chmodSync(path.join(first, "tool-server"), 0o644);
            fs.symlinkSync(process.execPath, path.join(second, "tool-server"));
            const launch = findProgram("tool-server", ["--version"], { platform: process.platform, pathEnv: `${first}:${second}` });
            expect(launch).toEqual({ command: path.join(second, "tool-server"), args: ["--version"] });
            const r = await run(launch!);
            expect(r.code).toBe(0);
            expect(r.stdout.trim()).toBe(Bun.version);
            expect(findProgram("no-such-server", [], { platform: process.platform, pathEnv: `${first}:${second}` })).toBeNull();
        });
    }
});
