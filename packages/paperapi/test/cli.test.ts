import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { linkPanel } from "../src/link";

const CLI = join(import.meta.dir, "..", "bin", "cli.ts");

let work: string;
let dataDir: string;
let home: string;

beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "paperapi-cli-"));
    dataDir = join(work, "data");
    home = join(work, "home");
    mkdirSync(join(dataDir, "local"), { recursive: true });
    mkdirSync(home);
});

afterEach(() => {
    rmSync(work, { recursive: true, force: true });
});

function panelFolder(id = "dev.test.linked"): string {
    const dir = join(work, id);
    mkdirSync(dir);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id, name: "Linked", version: "0.1.0" }));
    return dir;
}

interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
}

// the CLI as a developer runs it, in its own process
function cli(args: string[], cwd = work): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, PAPERBOARD_DIR: dataDir, HOME: home, USERPROFILE: home }, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => {
            stdout += c.toString();
        });
        child.stderr.on("data", (c: Buffer) => {
            stderr += c.toString();
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
}

async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

// Linking never clobbers an install or the real Paperboard, and the CLI guards its token.
describe("linking never clobbers an install or the real Paperboard, and the CLI guards its token", () => {
    test("paperapi link links into PAPERBOARD_DIR/panels and never into the home folder's Paperboard", async () => {
        const dir = panelFolder();
        const result = await cli(["link"], dir);
        expect(result.code).toBe(0);
        const link = join(dataDir, "panels", "dev.test.linked");
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(readlinkSync(link)).toBe(dir);
        expect(existsSync(join(home, ".paperboard"))).toBe(false);
    });

    test("an installed panel directory is not replaced without force, and is with it", async () => {
        const dir = panelFolder();
        const installed = join(dataDir, "panels", "dev.test.linked");
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, "manifest.json"), '{"id":"dev.test.linked","installed":true}');

        const refused = await cli(["link"], dir);
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("An installed copy of dev.test.linked already exists");
        expect(lstatSync(installed).isDirectory()).toBe(true);
        expect(readFileSync(join(installed, "manifest.json"), "utf8")).toContain('"installed":true');

        // the library call refuses the same way
        const previous = process.env.PAPERBOARD_DIR;
        process.env.PAPERBOARD_DIR = dataDir;
        try {
            expect(() => linkPanel({ targetDir: dir })).toThrow("Use --force to replace it");
        } finally {
            process.env.PAPERBOARD_DIR = previous;
        }

        const forced = await cli(["link", "--force"], dir);
        expect(forced.code).toBe(0);
        expect(lstatSync(installed).isSymbolicLink()).toBe(true);
    });

    test("unreadable command lines exit 2", async () => {
        for (const args of [["monitor", "--panel", "../escape"], ["unlink", "../escape"], ["no-such-command"], ["call", "dev.a", "act", "{}", "--timeout"]]) {
            const result = await cli(args);
            expect({ args, code: result.code }).toEqual({ args, code: 2 });
        }
    });

    test("a handshake naming a port nothing listens on is refused", async () => {
        const port = await freePort();
        writeFileSync(join(dataDir, "local", "crane.json"), JSON.stringify({ port, token: "host-secret" }));
        const result = await cli(["call", "dev.a"]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`nothing listens on 127.0.0.1:${port}`);
    });

    test("a listener that cannot prove it holds the token never receives it", async () => {
        const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
        const received: string[] = [];
        const headers: Record<string, unknown>[] = [];
        wss.on("connection", (ws, req) => {
            headers.push({ ...req.headers });
            ws.on("message", (raw) => received.push(raw.toString()));
            ws.send(JSON.stringify({ type: "daemon-proof", proof: "0".repeat(64) }));
        });
        try {
            const port = (wss.address() as net.AddressInfo).port;
            writeFileSync(join(dataDir, "local", "crane.json"), JSON.stringify({ port, token: "host-secret" }));
            const result = await cli(["call", "dev.a"]);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain("could not prove it is the Paperboard");
            expect(headers).toHaveLength(1);
            expect(JSON.stringify(headers[0])).not.toContain("host-secret");
            expect(received).toEqual([]);
        } finally {
            for (const client of wss.clients) client.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
    });

});
