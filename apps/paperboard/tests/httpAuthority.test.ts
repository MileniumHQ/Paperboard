import { test, expect } from "bun:test";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WebSocket } from "ws";
import { startPaperCraneServer } from "../papercrane/index";
import { pinnedRequest } from "../papercrane/pinnedTls";

async function request(port: number, method: string, target: string, headers: Record<string, string>) {
    return new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path: target, headers, timeout: 2000 }, res => {
            res.resume(); res.on("end", () => resolve(res.statusCode!));
        });
        req.on("timeout", () => req.destroy(new Error("request timed out")));
        req.on("error", reject);
        req.end(method === "PUT" ? "rebound write" : undefined);
    });
}

for (const noAuth of [true, false]) {
    test(`HTTP rejects rebound DAV authorities (noAuth=${noAuth})`, async () => {
        const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, noAuth, headless: true, advertise: false });
        try {
            const headers = { Host: `rebound.example:${daemon.port}`, Origin: "http://rebound.example", Authorization: "Bearer arbitrary", Depth: "0" };
            const statuses = await Promise.all([
                request(daemon.port, "PROPFIND", "/dav/", headers),
                request(daemon.port, "PUT", "/dav/files/rebound.txt", headers),
            ]);
            expect(statuses).toEqual([421, 421]);
            expect(fs.existsSync(path.join(process.env.PAPERBOARD_DIR!, "files/rebound.txt"))).toBe(false);
        } finally { daemon.stop(); }
    });
}

test("no-auth refuses a disallowed Origin even with a loopback Host", async () => {
    const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, noAuth: true, headless: true, advertise: false });
    try {
        expect(await request(daemon.port, "PROPFIND", "/dav/", { Origin: "http://evil.example", Authorization: "Bearer arbitrary", Depth: "0" })).toBe(403);
    } finally { daemon.stop(); }
});

test("no-auth rebound shutdown is refused before its exit action", async () => {
    const child = Bun.spawn([process.execPath, "run", "tests/fixtures/reboundShutdown.ts"], { stdout: "pipe", stderr: "pipe", env: process.env });
    try {
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ code, err: err.includes("error:") }).toEqual({ code: 0, err: false });
        expect(out).toContain("shutdown-status=421");
        expect(err).toContain("WARNING: --no-auth disables authentication");
    } finally { child.kill(); await child.exited; }
});

test("loopback Hosts and authenticated HTTP keep their existing credential policy", async () => {
    for (const noAuth of [true, false]) {
        const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, noAuth, staticToken: "host-token", headless: true, advertise: false });
        try {
            for (const host of ["127.0.0.42", "[::1]", "localhost", "panel.paperboard.localhost"]) {
                expect(await request(daemon.port, "PROPFIND", "/dav/", { Host: `${host}:${daemon.port}`, Authorization: `Bearer ${noAuth ? "arbitrary" : "host-token"}`, Depth: "0" })).toBe(207);
            }
            if (!noAuth) {
                expect(await request(daemon.port, "PROPFIND", "/dav/", { Authorization: "Bearer arbitrary", Depth: "0" })).toBe(401);
                expect(await request(daemon.port, "PROPFIND", "/dav/", { Authorization: "Bearer host-token", Origin: "http://remote.example", Depth: "0" })).toBe(207);
            }
        } finally { daemon.stop(); }
    }
});

test("WS upgrade rejects a rebound Host even without an Origin", async () => {
    const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}`, { headers: { Host: "rebound.example" }, handshakeTimeout: 2000 });
    try {
        const status = await new Promise<number>((resolve, reject) => {
            ws.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode!); });
            ws.on("open", () => resolve(101));
            ws.on("error", reject);
        });
        expect(status).toBe(421);
    } finally { ws.terminate(); daemon.stop(); }
});

test("non-loopback daemon permits pinned TLS via its interface IP and machine hostname", async () => {
    const daemon = await startPaperCraneServer({ host: "0.0.0.0", port: 0, headless: true, advertise: false, staticToken: "remote-host" });
    try {
        const cert = JSON.parse(fs.readFileSync(path.join(process.env.PAPERBOARD_DIR!, "local/tls_identity.json"), "utf8")).cert;
        const hosts = [os.hostname(), `${os.hostname().replace(/\.local$/i, "")}.local`, ...Object.values(os.networkInterfaces()).flatMap(entries => (entries ?? []).map(entry => entry.address))];
        for (const host of hosts) {
            const authority = host.includes(":") ? `[${host}]` : host;
            const result = await pinnedRequest(`https://127.0.0.1:${daemon.port}/dav/`, cert, { method: "PROPFIND", headers: { Host: `${authority}:${daemon.port}`, Authorization: "Bearer remote-host", Depth: "0" } });
            expect(result.status).toBe(207);
        }
    } finally { daemon.stop(); }
});
