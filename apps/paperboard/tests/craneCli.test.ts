// The papercrane command line, through the real entry (bun test spawns
// papercrane/main.ts): a wrong command line is refused with its usage
// instead of starting a daemon with defaults, and status / pair work against
// a real running daemon.
import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import pkg from "../package.json";

const MAIN = path.resolve(import.meta.dir, "../papercrane/main.ts");
const roots: string[] = [];
const daemons: ReturnType<typeof Bun.spawn>[] = [];

function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crane-cli-"));
    roots.push(root);
    return root;
}

afterAll(async () => {
    for (const d of daemons) { d.kill(); await d.exited; }
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
    const child = Bun.spawn([process.execPath, MAIN, ...args], {
        env: { ...process.env, PAPERBOARD_DIR: path.join(tempRoot(), "data"), ...env },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
}

async function startDaemon(): Promise<{ dataDir: string; port: number }> {
    const dataDir = path.join(tempRoot(), "data");
    const child = Bun.spawn([process.execPath, MAIN, "--headless", "--host", "127.0.0.1", "--port", "0", "--data-dir", dataDir], {
        env: { ...process.env, PAPERBOARD_DIR: "/nonexistent/--data-dir-must-win" }, stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    daemons.push(child);
    const handshake = path.join(dataDir, "local", "crane.json");
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(handshake)) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`daemon did not start: ${await new Response(child.stderr).text()}`);
        await Bun.sleep(20);
    }
    return { dataDir, port: JSON.parse(fs.readFileSync(handshake, "utf8")).port };
}

describe("a wrong command line", () => {
    // the old entry caught the parse error and started a daemon with defaults
    test("an unknown flag prints the error and usage and exits 2 without starting", async () => {
        const { code, err } = await cli(["--headles"]);
        expect(code).toBe(2);
        expect(err).toContain("unknown option '--headles'");
        expect(err).toContain("Usage: papercrane");
    }, 15_000);

    test("a port that is not a number is refused, not ignored", async () => {
        const { code, err } = await cli(["--port", "abc"]);
        expect(code).toBe(2);
        expect(err).toContain("--port must be a whole number from 0 to 65535");
    }, 15_000);

    test("PAPERCRANE_PORT that is not a number is refused, not replaced by the default", async () => {
        const { code, err } = await cli(["--headless"], { PAPERCRANE_PORT: "45464x" });
        expect(code).toBe(2);
        expect(err).toContain("PAPERCRANE_PORT must be a whole number");
    }, 15_000);

    test("an unknown command is named", async () => {
        const { code, err } = await cli(["strat"]);
        expect(code).toBe(2);
        expect(err).toContain("unknown command 'strat'");
    }, 15_000);

    test("--start-pairing with --headless is refused instead of doing nothing", async () => {
        const { code, err } = await cli(["--headless", "--start-pairing"]);
        expect(code).toBe(2);
        expect(err).toContain("papercrane pair");
    }, 15_000);
});

describe("help and version", () => {
    test("--version prints the version", async () => {
        const { code, out } = await cli(["--version"]);
        expect(code).toBe(0);
        expect(out.trim()).toBe(pkg.version);
    }, 15_000);

    test("--help lists the commands and serve's options, never the internal ones", async () => {
        const { code, out } = await cli(["--help"]);
        expect(code).toBe(0);
        for (const word of ["serve", "pair", "status", "install-service", "uninstall-service", "--port <port>", "--headless", "--data-dir <path>", "PAPERCRANE_PORT", "Exit codes"]) {
            expect(out).toContain(word);
        }
        for (const internal of ["--supervise", "--panel-service", "--allow-registry-override"]) expect(out).not.toContain(internal);
    }, 15_000);
});

describe("status", () => {
    test("exits 3 when no daemon runs for the data directory", async () => {
        const { code, out } = await cli(["status", "--json"]);
        expect(code).toBe(3);
        expect(JSON.parse(out).running).toBe(false);
    }, 15_000);

    test("reports a running daemon found through --data-dir", async () => {
        const { dataDir, port } = await startDaemon();
        const { code, out, err } = await cli(["status", "--json", "--data-dir", dataDir]);
        expect(err).toBe("");
        expect(code).toBe(0);
        const status = JSON.parse(out);
        expect(status).toMatchObject({ running: true, dataDir, version: pkg.version, listen: { host: "127.0.0.1", port, secure: false }, pairing: { active: false, computers: [] } });
        expect(typeof status.pid).toBe("number");
    }, 20_000);
});

describe("pair", () => {
    async function startPair(dataDir: string) {
        const child = Bun.spawn([process.execPath, MAIN, "pair", "--data-dir", dataDir], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        let out = "";
        const reading = (async () => { for await (const chunk of child.stdout as ReadableStream<Uint8Array>) out += new TextDecoder().decode(chunk); })();
        const deadline = Date.now() + 10_000;
        let code: string | undefined;
        while (!(code = /Pairing code: (\d{3}) (\d{3})/.exec(out)?.slice(1).join(""))) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error(`pair printed no code: ${out}${await new Response(child.stderr).text()}`);
            await Bun.sleep(20);
        }
        return { child, code, output: async () => { await reading; return out; } };
    }

    async function pairOver(port: number, code: string, clientName: string): Promise<any> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        await once(ws, "open");
        const reply = once(ws, "message");
        ws.send(JSON.stringify({ id: 1, action: "auth:pair", params: { code, clientName } }));
        const message = JSON.parse(String((await reply)[0]));
        ws.terminate();
        return message;
    }

    test("prints a code that pairs a computer, then exits 0 naming it", async () => {
        const { dataDir, port } = await startDaemon();
        const pair = await startPair(dataDir);
        const reply = await pairOver(port, pair.code, "Test Laptop");
        expect(reply.result?.success).toBe(true);
        expect(await pair.child.exited).toBe(0);
        expect(await pair.output()).toContain("Paired with Test Laptop.");
        const { out } = await cli(["status", "--json", "--data-dir", dataDir]);
        expect(JSON.parse(out).pairing.computers.map((c: { name: string }) => c.name)).toEqual(["Test Laptop"]);
    }, 25_000);

    test("Ctrl+C closes pairing again and exits 130", async () => {
        const { dataDir, port } = await startDaemon();
        const pair = await startPair(dataDir);
        pair.child.kill("SIGINT");
        expect(await pair.child.exited).toBe(130);
        expect(await pair.output()).toContain("Pairing cancelled.");
        const reply = await pairOver(port, pair.code, "Too Late");
        expect(String(reply.error)).toMatch(/not currently active/);
    }, 25_000);

    test("fails with a reason when no daemon is running", async () => {
        const { code, err } = await cli(["pair"]);
        expect(code).toBe(1);
        expect(err).toContain("No Paperboard server daemon is running");
    }, 15_000);
});
