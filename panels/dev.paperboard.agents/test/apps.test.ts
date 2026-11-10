import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Apps } from "../src/service/apps";
import { HomeFolder } from "../src/service/homeFolder";
import { tempDir } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

function get(port: number, target: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((ok, fail) => {
        const req = http.request({ host: "127.0.0.1", port, path: target, method: "GET", headers }, (res) => {
            let body = "";
            res.setEncoding("utf8").on("data", (d) => (body += d));
            res.on("end", () => ok({ status: res.statusCode!, headers: res.headers, body }));
        });
        req.on("error", fail);
        req.end();
    });
}

async function setup() {
    const root = tempDir("apps");
    const home = new HomeFolder(path.join(root, "home"));
    home.ensure();
    const apps = new Apps({
        home,
        portFile: path.join(root, "apps.json"),
        infoFile: path.join(root, "app-info.json"),
        picturesDir: path.join(root, "pictures"),
        picture: async () => "",
        post: () => {},
        onChange: () => {},
    });
    cleanups.push(async () => {
        await apps.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tools = apps.toolset();
    for (const name of ["planner", "other"]) {
        const r = await tools.call("start_app", { name, title: name, description: `the ${name}` }, { fromFlow: false });
        expect(r.isError).toBeFalsy();
        fs.writeFileSync(path.join(home.root, "Apps", name, "index.html"), `<h1>${name}</h1>`);
    }
    fs.writeFileSync(path.join(home.root, "Apps", "other", "private.json"), '{"other":"data"}');
    fs.writeFileSync(path.join(home.root, "diary.txt"), "the rest of home");
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "off the computer's home");
    fs.symlinkSync(outside, path.join(home.root, "Apps", "planner", "out.txt"));
    fs.symlinkSync(path.join(home.root, "Apps", "other"), path.join(home.root, "Apps", "planner", "sibling"));
    return { apps, port: apps.port! };
}

// The app server is isolated.
describe("the app server", () => {
    test("an app is served only at <name>.localhost:<port>, with a 'self' CSP and same-origin CORP", async () => {
        const { port } = await setup();
        const ok = await get(port, "/", { host: `planner.localhost:${port}` });
        expect(ok.status).toBe(200);
        expect(ok.body).toBe("<h1>planner</h1>");
        expect(ok.headers["content-security-policy"]).toContain("default-src 'self'");
        expect(ok.headers["content-security-policy"]).toContain("connect-src 'self'");
        expect(ok.headers["cross-origin-resource-policy"]).toBe("same-origin");
        // DNS rebinding: any other name pointed at the port
        for (const host of ["evil.com", `evil.com:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `planner.localhost:${port + 1}`, `planner.localhost.evil.com:${port}`]) {
            const r = await get(port, "/", { host });
            expect(r.status).toBe(421);
            expect(r.body).not.toContain("planner</h1>");
        }
    });

    test("cross-site fetches get 403; the app's own pages and a typed address don't", async () => {
        const { port } = await setup();
        const host = `planner.localhost:${port}`;
        expect((await get(port, "/", { host, "sec-fetch-site": "cross-site", "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors" })).status).toBe(403);
        expect((await get(port, "/", { host, "sec-fetch-site": "same-site", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" })).status).toBe(403);
        expect((await get(port, "/", { host, "sec-fetch-site": "same-origin" })).status).toBe(200);
        expect((await get(port, "/", { host, "sec-fetch-site": "none" })).status).toBe(200);
    });

    test("encoded .., links out, other apps' files and the rest of home get 404", async () => {
        const { port } = await setup();
        const host = `planner.localhost:${port}`;
        for (const target of ["/%2e%2e/other/private.json", "/..%2fother%2fprivate.json", "/%2e%2e/%2e%2e/diary.txt", "/../../diary.txt", "/out.txt", "/sibling/private.json", "/%2e%2e%2f%2e%2e%2f%2e%2e%2foutside.txt", "/index.html%00.png"]) {
            const r = await get(port, target, { host });
            expect(r.status).toBe(404);
            expect(r.body).not.toContain("data");
            expect(r.body).not.toContain("the rest of home");
            expect(r.body).not.toContain("off the computer");
        }
        // the other app's file is served to that app, at its own origin
        expect((await get(port, "/private.json", { host: `other.localhost:${port}` })).body).toBe('{"other":"data"}');
    });
});
