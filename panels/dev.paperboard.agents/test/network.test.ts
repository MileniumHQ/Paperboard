import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { BROWSER_PROC_ID, BrowserComputer } from "../src/service/browser";
import { HomeFolder } from "../src/service/homeFolder";
import { refusal } from "../src/service/netPolicy";
import { startProxy } from "../src/service/proxy";
import { shellToolset } from "../src/service/shell";
import type { ComputerState } from "../src/contract";
import { fakeEnv, packageHost, Recorder, SLOW, tempDir, TestHost } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

/** A server on every interface of this computer, the kind the agent must never reach; counts what reaches it. */
async function localService() {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
        hits.push(`${req.headers.host} ${req.url}`);
        res.end("LOCAL SERVICE");
    });
    await new Promise<void>((ok) => server.listen(0, "0.0.0.0", ok));
    cleanups.push(() => new Promise<void>((ok) => server.close(() => ok())));
    return { port: (server.address() as AddressInfo).port, hits };
}

/** This computer's own address on its network, which a service on 0.0.0.0 answers on too. */
function ownAddress(): string {
    const own = Object.values(os.networkInterfaces())
        .flat()
        .find((i) => i && !i.internal && i.family === "IPv4");
    if (!own) throw new Error("this computer has no network address to test against");
    return own.address;
}

// The shell and browser reach only the public web.
describe("the shell's network", () => {
    test("curl and fetch refuse this computer by any name or number", async () => {
        const { port, hits } = await localService();
        const root = tempDir("shellnet");
        cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const home = new HomeFolder(root);
        home.ensure();
        const shell = shellToolset(home);
        const run = (command: string) => shell.call("bash", { command }, { fromFlow: false });
        for (const host of ["127.0.0.1", "localhost", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0", "2130706433", ownAddress()]) {
            const r = await run(`curl -sS http://${host}:${port}/`);
            expect(r.text).toContain("Network access denied");
            expect(r.text).not.toContain("LOCAL SERVICE");
        }
        const js = await run(`js-exec -c 'try { console.log(await (await fetch("http://127.0.0.1:${port}/")).text()) } catch (e) { console.log("refused: " + e.message) }'`);
        expect(js.text).toContain("refused: Network access denied");
        expect(hits).toEqual([]);
    });
});

// The shell and browser reach only the public web.
describe("the browser's proxy", () => {
    const LOCAL_NAMES: Record<string, string[]> = { "intranet.example": ["10.1.2.3", "127.0.0.1"], "planner.localhost": ["127.0.0.1"], "router.example": ["192.168.1.1"] };
    const lookup = async (h: string) => {
        const found = LOCAL_NAMES[h];
        if (!found) throw new Error(`the test resolves no ${h}`);
        return found.map((address) => ({ address }));
    };

    async function proxy(local?: (host: string, port: number) => boolean) {
        const p = await startProxy({ lookup, local });
        cleanups.push(() => p.close());
        return p.port;
    }

    const viaProxy = (proxyPort: number, url: string): Promise<{ status: number; body: string }> =>
        new Promise((ok, fail) => {
            const req = http.request({ host: "127.0.0.1", port: proxyPort, path: url, headers: { host: new URL(url).host } }, (res) => {
                let body = "";
                res.setEncoding("utf8").on("data", (d) => (body += d));
                res.on("end", () => ok({ status: res.statusCode!, body }));
            });
            req.on("error", fail);
            req.end();
        });

    const connect = (proxyPort: number, authority: string): Promise<number> =>
        new Promise((ok, fail) => {
            const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: authority });
            req.on("connect", (res, socket) => {
                socket.destroy();
                ok(res.statusCode!);
            });
            req.on("error", fail);
            req.end();
        });

    test("loopback, private, link-local, CGNAT, metadata and embedded-IPv4 addresses, local-only names and this computer get 403", async () => {
        const { port, hits } = await localService();
        const p = await proxy();
        for (const url of [
            `http://127.0.0.1:${port}/`,
            `http://[::1]:${port}/`,
            `http://[::ffff:127.0.0.1]:${port}/`,
            `http://[::ffff:7f00:1]:${port}/`,
            `http://${ownAddress()}:${port}/`,
            `http://intranet.example:${port}/`,
            `http://router.example/`,
            "http://10.0.0.1/",
            "http://172.16.5.4/",
            "http://192.168.0.1/",
            "http://100.64.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://100.100.100.200/",
            "http://168.63.129.16/",
            "http://[fd00:ec2::254]/",
            "http://[fe80::1]/",
            "http://[64:ff9b::a9fe:a9fe]/",
            "http://[2002:7f00:1::]/",
        ]) {
            const r = await viaProxy(p, url);
            expect({ url, status: r.status }).toEqual({ url, status: 403 });
        }
        for (const authority of [`127.0.0.1:${port}`, `[::1]:${port}`, `${ownAddress()}:${port}`, `intranet.example:${port}`, `planner.localhost:${port}`, "169.254.169.254:443"]) {
            expect({ authority, status: await connect(p, authority) }).toEqual({ authority, status: 403 });
        }
        expect(hits).toEqual([]);
        // and the public internet is allowed, by the same rule
        for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "1.1.1.1"]) expect(refusal(ip)).toBeNull();
    });

    test("the agent's apps over plain HTTP at <name>.localhost are the only way in", async () => {
        const { port, hits } = await localService();
        const p = await proxy((host, at) => at === port && /^[a-z0-9-]+\.localhost$/.test(host));
        const app = await viaProxy(p, `http://planner.localhost:${port}/`);
        expect(app).toEqual({ status: 200, body: "LOCAL SERVICE" });
        expect(hits).toEqual([`planner.localhost:${port} /`]);
        // the same server by any other way, or the apps' name on another port, is refused
        expect((await viaProxy(p, `http://127.0.0.1:${port}/`)).status).toBe(403);
        expect((await viaProxy(p, `http://planner.localhost:${port + 1}/`)).status).toBe(403);
        expect(await connect(p, `planner.localhost:${port}`)).toBe(403);
        expect(hits).toHaveLength(1);
    });
});

// The shell and browser reach only the public web (the browser's sandbox).
describe("the browser's sandbox", () => {
    test("a browser that can't sandbox itself fails with why, and is never retried with --no-sandbox", async () => {
        const root = tempDir("browser");
        cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const helium = path.join(root, "packages", "helium");
        fs.mkdirSync(path.join(helium, "bin"), { recursive: true });
        fs.copyFileSync(path.join(import.meta.dir, "support", "fakeHelium.mjs"), path.join(helium, "bin", "helium"));
        const dir = path.join(root, "storage", "browser");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "browser.json"), JSON.stringify({ version: 1, installed: true, chromium: 140 }));
        const host = new TestHost(fakeEnv(root));
        cleanups.push(() => host.close());
        const states = new Recorder<ComputerState>();
        const home = new HomeFolder(path.join(root, "storage", "home"));
        const computer = new BrowserComputer({ host: { ...host, packages: packageHost({ helium }) }, dir, home, storagePath: "browser", onState: states.push, platform: "linux", arch: "x64" });
        cleanups.push(() => computer.shutdown());
        await expect(computer.init()).rejects.toThrow("won't let the browser use its sandbox");
        await expect(computer.start()).rejects.toThrow("won't let the browser use its sandbox");
        const launches = host.startedAs(BROWSER_PROC_ID);
        expect(launches).toHaveLength(2);
        const ran = fs.readFileSync(path.join(root, "helium.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
        expect(ran).toHaveLength(2);
        for (const args of [...launches.map((l) => l.args), ...ran]) {
            expect(args.some((a) => /sandbox/i.test(a))).toBe(false);
            expect(args).toContain("--proxy-bypass-list=<-loopback>");
        }
        expect(states.last()).toMatchObject({ phase: "failed" });
        expect(states.last()!.error).toContain("doesn't run without one");
    }, SLOW);
});
