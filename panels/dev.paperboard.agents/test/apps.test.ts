// The agent's apps, over the real boundaries: a registry served over HTTP
// with real tarballs, the real esbuild, and the app server over HTTP.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { Apps } from "../src/service/apps";
import { HomeFolder } from "../src/service/homeFolder";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});
function tempDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ai-apps-"));
    cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
    return d;
}

/** one tar entry, as npm's tarballs have them */
function entry(name: string, data = "", type = "0", link = ""): Buffer {
    const body = Buffer.from(data);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100);
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136);
    h.fill(" ", 148, 156);
    h.write(type, 156);
    h.write(link, 157, 100);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

interface FakeVersion {
    deps?: Record<string, string>;
    peers?: Record<string, string>;
    files: Record<string, string>;
    /** entries beyond the files, e.g. a link */
    extra?: Buffer[];
    /** a tarball the registry's checksum doesn't match */
    tampered?: boolean;
}

/** An npm registry on loopback, serving packuments and tarballs. */
async function registry(pkgs: Record<string, Record<string, FakeVersion>>) {
    const tarballs = new Map<string, Buffer>();
    const server = http.createServer();
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const packuments = new Map<string, unknown>();
    for (const [name, versions] of Object.entries(pkgs)) {
        const out: Record<string, unknown> = {};
        for (const [version, v] of Object.entries(versions)) {
            const files = Object.entries({ "package.json": JSON.stringify({ name, version }), ...v.files }).map(([p, d]) => entry(`package/${p}`, d));
            const tgz = zlib.gzipSync(Buffer.concat([...files, ...(v.extra ?? []), Buffer.alloc(1024)]));
            const file = `/${name}/-/${name.split("/").pop()}-${version}.tgz`;
            tarballs.set(file, v.tampered ? Buffer.concat([tgz, Buffer.from("x")]) : tgz);
            out[version] = {
                version,
                dependencies: v.deps,
                peerDependencies: v.peers,
                dist: { tarball: url + file, integrity: `sha512-${createHash("sha512").update(tgz).digest("base64")}` },
            };
        }
        const latest = Object.keys(versions).sort().pop()!;
        packuments.set(`/${name.replace("/", "%2f")}`, { "dist-tags": { latest }, versions: out });
    }
    server.on("request", (req, res) => {
        const p = packuments.get(req.url ?? "");
        if (p) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(p));
        const t = tarballs.get(req.url ?? "");
        if (t) return res.writeHead(200).end(t);
        res.writeHead(404).end("{}");
    });
    cleanups.push(() => new Promise<void>((ok) => server.close(() => ok())));
    return url;
}

async function setup(pkgs: Record<string, Record<string, FakeVersion>> = {}) {
    const storage = tempDir();
    const home = new HomeFolder(path.join(storage, "home"));
    home.ensure();
    const apps = new Apps({ home, portFile: path.join(storage, "apps.json"), registry: await registry(pkgs) });
    cleanups.push(() => apps.close());
    const tools = apps.toolset();
    const call = (name: string, args: Record<string, unknown>) => tools.call(name, args);
    return { storage, home, apps, call };
}

/** a request to an app as the browser sends it, to a name at the app server */
function get(port: number, url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const u = new URL(url);
    return new Promise((ok, fail) => {
        http.get({ host: "127.0.0.1", port, path: u.pathname + u.search, headers: { Host: u.host, ...headers } }, (res) => {
            let body = "";
            res.on("data", (d) => (body += d)).on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
        }).on("error", fail);
    });
}

describe("the agent's apps", () => {
    test("start_app makes a folder with a package.json and nothing else, and serves it at its own name", async () => {
        const { home, apps, call } = await setup();
        const made = await call("start_app", { name: "planner" });
        expect(made.isError).toBeUndefined();
        expect(made.text).toBe(`~/Apps/planner is served at http://planner.localhost:${apps.port}/ It shows ~/Apps/planner/index.html once there is one.`);
        expect(fs.readdirSync(home.resolve("~/Apps/planner"))).toEqual(["package.json"]);
        expect(JSON.parse(home.read("~/Apps/planner/package.json").data.toString())).toEqual({ name: "planner", private: true, dependencies: {} });

        home.write("~/Apps/planner/index.html", Buffer.from("<h1>Due this week</h1>"));
        const page = await get(apps.port!, apps.url("planner"));
        expect(page.status).toBe(200);
        expect(page.body).toBe("<h1>Due this week</h1>");
        expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
        // it reaches nothing but its own files
        expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
        expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
        expect(page.headers["cross-origin-resource-policy"]).toBe("same-origin");
        // a name that isn't one is refused before anything is made
        for (const name of ["Planner", "../x", "a b", "-x", "x".repeat(41)]) expect((await call("start_app", { name })).isError).toBe(true);
    });

    test("a page's script is bundled as it loads, with its packages, its CSS and the browser's side of each", async () => {
        const { home, apps, call } = await setup({
            // a package with a Node side and a browser side, depending on a CommonJS one
            greet: {
                "1.2.0": {
                    deps: { shout: "^2.0.0" },
                    files: {
                        "package.json": JSON.stringify({ name: "greet", version: "1.2.0", exports: { ".": { node: "./node.js", browser: "./browser.js", default: "./node.js" } } }),
                        "browser.js": "import shout from 'shout'; import './greet.css'; export const greet = (n) => shout('hi ' + n);",
                        "node.js": "import fs from 'fs'; export const greet = () => fs.readFileSync('/etc/passwd');",
                        "greet.css": ".greeting { font-weight: bold }",
                    },
                },
            },
            shout: { "2.1.0": { files: { "index.js": "module.exports = (s) => s.toUpperCase() + '!';" } } },
        });
        await call("start_app", { name: "hello" });
        const added = await call("add_package", { app: "hello", packages: ["greet"] });
        expect(added.text).toBe("~/Apps/hello has greet@1.2.0 (2 packages in all). Its scripts import them by name.");
        expect(JSON.parse(home.read("~/Apps/hello/package.json").data.toString()).dependencies).toEqual({ greet: "^1.2.0" });

        home.write("~/Apps/hello/src/main.ts", Buffer.from("import { greet } from 'greet';\nimport { who } from './who';\nconst n: string = who;\ndocument.title = greet(n);\n"));
        home.write("~/Apps/hello/src/who.ts", Buffer.from("export const who = 'pip';\n"));
        const script = await get(apps.port!, `${apps.url("hello")}src/main.ts`);
        expect(script.status).toBe(200);
        expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
        expect(script.body).not.toContain("/etc/passwd");
        expect(script.body).not.toContain(home.root);

        // it runs: the CSS goes into the page and the title is set
        const styles: string[] = [];
        const document = { title: "", head: { append: (s: { textContent: string }) => styles.push(s.textContent) }, createElement: () => ({ textContent: "" }) };
        vm.runInNewContext(script.body, { document });
        expect(document.title).toBe("HI PIP!");
        expect(styles.join("")).toContain(".greeting");
    });

    test("a reload gets what's in the files now: an edit, a new package", async () => {
        const { home, apps, call } = await setup({ mood: { "1.0.0": { files: { "index.js": "export default 'calm';" } }, "2.0.0": { files: { "index.js": "export default 'busy';" } } } });
        await call("start_app", { name: "live" });
        await call("add_package", { app: "live", packages: ["mood@1"] });
        home.write("~/Apps/live/main.js", Buffer.from("import mood from 'mood'; globalThis.out = mood + ' monday';"));
        const run = async () => {
            const g: { out?: string } = {};
            vm.runInNewContext((await get(apps.port!, `${apps.url("live")}main.js`)).body, { globalThis: g });
            return g.out;
        };
        expect(await run()).toBe("calm monday");
        expect(await run()).toBe("calm monday");
        home.write("~/Apps/live/main.js", Buffer.from("import mood from 'mood'; globalThis.out = mood + ' tuesday';"));
        expect(await run()).toBe("calm tuesday");
        await call("add_package", { app: "live", packages: ["mood@2"] });
        expect(await run()).toBe("busy tuesday");
    });

    test("a script that doesn't build says why on the page, Node's modules and missing packages included", async () => {
        const { home, apps, call } = await setup();
        await call("start_app", { name: "broken" });
        const cases: [string, RegExp][] = [
            ["import fs from 'node:fs'; fs;", /"node:fs" is part of Node, not the browser/],
            ["import 'path';", /"path" is part of Node, not the browser/],
            ["import 'left-pad';", /"left-pad" isn't installed: add it with add_package/],
            ["import 'https://esm.sh/react';", /is on the web: an app only loads its own files/],
            ["import '../../../secret.txt';", /outside the app's folder|no file at/],
            ["const x = ;", /Unexpected/],
        ];
        for (const [code, why] of cases) {
            home.write("~/Apps/broken/main.js", Buffer.from(code));
            const r = await get(apps.port!, `${apps.url("broken")}main.js`);
            expect(r.status).toBe(200);
            // what the page shows, as it runs in the browser
            const shown: string[] = [];
            const document = { readyState: "complete", createElement: () => ({ style: {} }), documentElement: { append: (e: { textContent: string }) => shown.push(e.textContent) } };
            vm.runInNewContext(r.body, { document, console: { error: (m: string) => shown.push(m) } });
            expect(shown).toHaveLength(2);
            expect(shown[0]).toStartWith("This app's script didn't build:\n\n");
            expect(shown[0]).toMatch(why);
            expect(shown[0]).not.toContain(home.root);
            expect(shown[0]).not.toContain("[plugin");
        }
    });

    test("an app's server answers only its own names and pages, with only its own files", async () => {
        const { storage, home, apps, call } = await setup();
        await call("start_app", { name: "one" });
        await call("start_app", { name: "two" });
        home.write("~/Apps/one/index.html", Buffer.from("one"));
        home.write("~/Apps/two/secret.json", Buffer.from('{"two":"secret"}'));
        home.write("~/notes.txt", Buffer.from("home secret"));
        fs.writeFileSync(path.join(storage, "outside.txt"), "outside secret");
        fs.symlinkSync(path.join(storage, "outside.txt"), path.join(home.resolve("~/Apps/one"), "linked.txt"));
        const port = apps.port!;
        const bodies: string[] = [];
        const refused = async (url: string, status: number, headers: Record<string, string> = {}) => {
            const r = await get(port, url, headers);
            expect(r.status, url).toBe(status);
            bodies.push(r.body);
        };
        // another name pointed at the server (DNS rebinding), or no app's name
        await refused(`http://evil.example:${port}/`, 421);
        await refused(`http://127.0.0.1:${port}/`, 421);
        await refused(`http://one.localhost:${port + 1}/`, 421);
        // another site's page asking for its files
        await refused(`http://one.localhost:${port}/`, 403, { "Sec-Fetch-Site": "cross-site" });
        await refused(`http://one.localhost:${port}/`, 403, { "Sec-Fetch-Site": "same-site" });
        // other apps', the rest of the home folder's, and through a link
        await refused(`http://one.localhost:${port}/%2e%2e/two/secret.json`, 404);
        await refused(`http://one.localhost:${port}/..%2f..%2fnotes.txt`, 404);
        await refused(`http://one.localhost:${port}/linked.txt`, 404);
        await refused(`http://nope.localhost:${port}/`, 404);
        for (const leaked of ['"two":"secret"', "home secret", "outside secret"]) expect(bodies.join("\n")).not.toContain(leaked);
        // its own page, as its pages ask for it or typed in
        expect((await get(port, `http://one.localhost:${port}/`, { "Sec-Fetch-Site": "same-origin" })).body).toBe("one");
        expect((await get(port, `http://one.localhost:${port}/`, { "Sec-Fetch-Site": "none" })).body).toBe("one");
    });

    test("the apps keep their port from one start to the next, so what they saved stays theirs", async () => {
        const { storage, home, apps, call } = await setup();
        await call("start_app", { name: "keep" });
        const port = apps.port;
        await apps.close();
        const again = new Apps({ home, portFile: path.join(storage, "apps.json") });
        cleanups.push(() => again.close());
        expect((await again.toolset().call("start_app", { name: "keep" })).text).toContain(`http://keep.localhost:${port}/`);
    });
});

describe("adding packages", () => {
    test("versions are laid out the way Node finds them: shared at the top, a clash beside what needs it", async () => {
        const { home, call } = await setup({
            a: { "1.0.0": { deps: { b: "^1.0.0" }, files: {} } },
            c: { "1.0.0": { deps: { b: "^2.0.0" }, files: {} } },
            b: { "1.4.0": { files: {} }, "2.0.1": { files: {} } },
        });
        await call("start_app", { name: "tree" });
        const r = await call("add_package", { app: "tree", packages: ["a", "c@1"] });
        expect(r.text).toBe("~/Apps/tree has a@1.0.0, c@1.0.0 (4 packages in all). Its scripts import them by name.");
        const version = (p: string) => JSON.parse(home.read(`~/Apps/tree/node_modules/${p}/package.json`).data.toString()).version;
        expect(version("b")).toBe("1.4.0");
        expect(version("c/node_modules/b")).toBe("2.0.1");
        expect(JSON.parse(home.read("~/Apps/tree/package.json").data.toString()).dependencies).toEqual({ a: "^1.0.0", c: "1" });
        // with none given, it installs what package.json lists: after the folder's gone, too
        fs.rmSync(home.resolve("~/Apps/tree/node_modules"), { recursive: true });
        expect((await call("add_package", { app: "tree" })).text).toStartWith("~/Apps/tree has a@1.0.0, c@1.0.0 (4 packages");
    });

    test("a tarball that doesn't match the registry's checksum installs nothing, and what was there stays", async () => {
        const { home, call } = await setup({ good: { "1.0.0": { files: { "index.js": "1" } } }, bad: { "1.0.0": { tampered: true, files: { "index.js": "evil" } } } });
        await call("start_app", { name: "safe" });
        await call("add_package", { app: "safe", packages: ["good"] });
        const r = await call("add_package", { app: "safe", packages: ["bad"] });
        expect(r).toEqual({ text: "bad@1.0.0 doesn't match the registry's checksum; nothing was installed", isError: true });
        expect(fs.readdirSync(home.resolve("~/Apps/safe/node_modules"))).toEqual(["good"]);
        expect(fs.readdirSync(home.resolve("~/Apps/safe")).sort()).toEqual(["node_modules", "package.json"]);
        expect(JSON.parse(home.read("~/Apps/safe/package.json").data.toString()).dependencies).toEqual({ good: "^1.0.0" });
    });

    test("only a package's regular files are unpacked: no links, and nothing that would land outside it", async () => {
        const { storage, home, call } = await setup({
            linky: { "1.0.0": { files: { "index.js": "1" }, extra: [entry("package/passwd", "", "2", "/etc/passwd")] } },
            climber: { "1.0.0": { files: {}, extra: [entry("package/../../../../escaped.txt", "gotcha")] } },
        });
        await call("start_app", { name: "unpack" });
        expect((await call("add_package", { app: "unpack", packages: ["linky"] })).isError).toBeUndefined();
        expect(fs.readdirSync(home.resolve("~/Apps/unpack/node_modules/linky")).sort()).toEqual(["index.js", "package.json"]);
        const climbed = await call("add_package", { app: "unpack", packages: ["climber"] });
        expect(climbed.isError).toBe(true);
        expect(climbed.text).toContain("can't be unpacked safely");
        const everywhere = [storage, path.dirname(storage)].flatMap((d) => fs.readdirSync(d));
        expect(everywhere).not.toContain("escaped.txt");
    });

    test("a peer two packages disagree on is refused, rather than a second copy that breaks the app", async () => {
        const { call } = await setup({
            react: { "18.3.1": { files: {} }, "19.2.0": { files: {} } },
            "old-widget": { "1.0.0": { peers: { react: "^18.0.0" }, files: {} } },
        });
        await call("start_app", { name: "peers" });
        const r = await call("add_package", { app: "peers", packages: ["react@19", "old-widget"] });
        expect(r).toEqual({ text: "old-widget needs react@^18.0.0, and the app has react@19.2.0: add a version of one that fits the other", isError: true });
    });

    test("what isn't a package from the registry is refused before anything is fetched", async () => {
        const { call } = await setup();
        await call("start_app", { name: "names" });
        for (const p of ["git+https://github.com/x/y", "file:../x", "https://x.example/y.tgz", "a b"]) {
            expect((await call("add_package", { app: "names", packages: [p] })).isError, p).toBe(true);
        }
        expect(await call("add_package", { app: "nowhere", packages: ["react"] })).toEqual({ text: "there's no app called nowhere: make it with start_app first", isError: true });
        expect((await call("add_package", { app: "names", packages: ["not-on-the-registry"] })).text).toBe("there's no package called not-on-the-registry on the npm registry");
    });
});
