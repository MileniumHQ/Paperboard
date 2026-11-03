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
import type { AppEntry } from "../src/contract";
import { Apps, type AppsOptions } from "../src/service/apps";
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

/** a JPEG's first bytes: what the browser's picture of a page starts with */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
/** what a new app is called and is for */
const about = { title: "An app", description: "For a test." };

/** the service's side of the apps: where it keeps them, and what it hears from them */
function options(storage: string, home: HomeFolder) {
    const posted: AppEntry[] = [];
    const pictured: string[] = [];
    const changes = { count: 0 };
    const o: AppsOptions = {
        home,
        portFile: path.join(storage, "apps.json"),
        infoFile: path.join(storage, "app-info.json"),
        picturesDir: path.join(storage, "app-pictures"),
        picture: async (url) => {
            pictured.push(url);
            return JPEG;
        },
        post: (e) => posted.push(e),
        onChange: () => changes.count++,
    };
    return { o, posted, pictured, changes };
}

async function setup(pkgs: Record<string, Record<string, FakeVersion>> = {}) {
    const storage = tempDir();
    const home = new HomeFolder(path.join(storage, "home"));
    home.ensure();
    const heard = options(storage, home);
    const apps = new Apps({ ...heard.o, registry: await registry(pkgs) });
    cleanups.push(() => apps.close());
    const tools = apps.toolset();
    const call = (name: string, args: Record<string, unknown>) => tools.call(name, name === "start_app" ? { ...about, ...args } : args);
    return { storage, home, apps, tools, call, ...heard };
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
        const again = new Apps(options(storage, home).o);
        cleanups.push(() => again.close());
        expect((await again.toolset().call("start_app", { name: "keep" })).text).toContain(`http://keep.localhost:${port}/`);
    });

    // Windows reserves ranges of ports anew at each boot and refuses them with EACCES; here a
    // port below 1024 is refused the same way
    test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("the apps move when the system won't open their port", async () => {
        const { storage, home } = await setup();
        fs.writeFileSync(path.join(storage, "apps.json"), JSON.stringify({ port: 1 }));
        const apps = new Apps(options(storage, home).o);
        cleanups.push(() => apps.close());
        expect((await apps.toolset().call("start_app", { ...about, name: "moved" })).isError).toBeUndefined();
        expect(apps.port).toBeGreaterThan(1024);
        expect(JSON.parse(fs.readFileSync(path.join(storage, "apps.json"), "utf8")).port).toBe(apps.port);
    });
});

describe("the user's side of the apps", () => {
    test("a new app needs a title and a description, kept by the service, and a later start can change them", async () => {
        const { storage, home, tools, apps, changes } = await setup();
        expect(await tools.call("start_app", { name: "nameless" })).toEqual({ text: "give a new app a title and a description: they're how the user knows it", isError: true });
        expect(fs.existsSync(home.resolve("~/Apps/nameless"))).toBe(false);
        expect((await tools.call("start_app", { name: "plan", title: " ", description: "x" })).isError).toBe(true);
        expect((await tools.call("start_app", { name: "plan", title: "x".repeat(61), description: "x" })).isError).toBe(true);

        expect((await tools.call("start_app", { name: "plan", title: "Assignment  planner", description: "What's due, by class." })).isError).toBeUndefined();
        expect(changes.count).toBe(1);
        // nothing of it in the agent's files
        expect(fs.readdirSync(home.resolve("~/Apps/plan"))).toEqual(["package.json"]);
        expect(JSON.parse(fs.readFileSync(path.join(storage, "app-info.json"), "utf8"))).toEqual({ apps: { plan: { title: "Assignment planner", description: "What's due, by class." } } });
        // started again with neither: it keeps them, and nothing changed
        await tools.call("start_app", { name: "plan" });
        expect(changes.count).toBe(1);
        await tools.call("start_app", { name: "plan", title: "Planner" });
        expect(apps.list()).toEqual([{ name: "plan", title: "Planner", description: "What's due, by class.", picture: false }]);
        expect(changes.count).toBe(2);
    });

    test("show_app posts a card with the app's picture, taken of its own address; it never gives the agent a link to send", async () => {
        const { home, apps, call, posted, pictured, changes } = await setup();
        await call("start_app", { name: "clock", title: "Clock", description: "The time, big." });
        expect(await call("show_app", { app: "clock" })).toEqual({ text: "~/Apps/clock has no index.html to show yet", isError: true });
        expect(await call("show_app", { app: "nope" })).toEqual({ text: "there's no app called nope", isError: true });
        expect(posted).toEqual([]);

        home.write("~/Apps/clock/index.html", Buffer.from("<h1>12:00</h1>"));
        const before = changes.count;
        const shown = await call("show_app", { app: "clock" });
        expect(shown).toEqual({ text: "Showed Clock to the user as a card in the chat. They open it from there, beside the chat." });
        expect(shown.text).not.toContain("localhost");
        expect(pictured).toEqual([apps.url("clock")]);
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ kind: "app", app: "clock", title: "Clock", description: "The time, big." });
        expect(changes.count).toBe(before + 1);
        expect(apps.pictureOf("clock")).toEqual({ image: JPEG });
        expect(apps.list()[0]!.picture).toBe(true);
        expect(await apps.open("clock")).toEqual({ url: apps.url("clock"), title: "Clock" });
    });

    test("a picture that can't be taken shows nothing, and says why", async () => {
        const storage = tempDir();
        const home = new HomeFolder(path.join(storage, "home"));
        home.ensure();
        const heard = options(storage, home);
        const apps = new Apps({ ...heard.o, picture: async () => Promise.reject(new Error("your computer is off")) });
        cleanups.push(() => apps.close());
        const tools = apps.toolset();
        await tools.call("start_app", { name: "dark", ...about });
        home.write("~/Apps/dark/index.html", Buffer.from("hi"));
        expect(await tools.call("show_app", { app: "dark" })).toEqual({ text: "dark wasn't shown: its picture couldn't be taken (your computer is off)", isError: true });
        expect(heard.posted).toEqual([]);
        expect(() => apps.pictureOf("dark")).toThrow("there's no picture of dark yet");
    });

    test("the list is every folder in ~/Apps, newest first; delete_app takes the folder, its title and its picture", async () => {
        const { storage, home, apps, call } = await setup();
        expect(apps.list()).toEqual([]);
        await call("start_app", { name: "older", title: "Older", description: "First." });
        await Bun.sleep(20);
        await call("start_app", { name: "newer", title: "Newer", description: "Second." });
        // one the agent made by hand goes by its name
        await Bun.sleep(20);
        fs.mkdirSync(home.resolve("~/Apps/by-hand"));
        home.write("~/Apps/older/index.html", Buffer.from("old"));
        await call("show_app", { app: "older" });
        expect(apps.list().map((a) => [a.name, a.title, a.picture])).toEqual([
            ["by-hand", "by-hand", false],
            ["newer", "Newer", false],
            ["older", "Older", true],
        ]);

        expect(await call("delete_app", { app: "older" })).toEqual({ text: "~/Apps/older is deleted. A checkpoint from before now still has it." });
        expect(fs.existsSync(home.resolve("~/Apps/older"))).toBe(false);
        expect(fs.readdirSync(path.join(storage, "app-pictures"))).toEqual([]);
        expect(Object.keys(JSON.parse(fs.readFileSync(path.join(storage, "app-info.json"), "utf8")).apps)).toEqual(["newer"]);
        expect(apps.list().map((a) => a.name)).toEqual(["by-hand", "newer"]);
        expect((await call("delete_app", { app: "older" })).isError).toBe(true);
        expect((await call("delete_app", { app: "../home" })).isError).toBe(true);
        // its address answers that there's no such app now
        expect((await get(apps.port!, apps.url("older"))).status).toBe(404);
        // the user deletes the same way
        apps.remove("newer");
        expect(apps.list().map((a) => a.name)).toEqual(["by-hand"]);
    });

    test("only the panel can show an app in a frame, and a frame of it is the only cross-site request let through", async () => {
        const { home, apps, call } = await setup();
        await call("start_app", { name: "framed" });
        home.write("~/Apps/framed/index.html", Buffer.from("in a frame"));
        const framing = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" };
        const page = await get(apps.port!, apps.url("framed"), framing);
        expect(page.status).toBe(200);
        expect(page.body).toBe("in a frame");
        const ancestors = page.headers["content-security-policy"]!.match(/frame-ancestors ([^;]+)/)![1]!.split(" ");
        expect(ancestors).toEqual(["paperboard:", "panel:", "http://localhost:*", "http://paperboard.localhost:*", "http://*.paperboard.localhost:*"]);
        // no other app's page, and no web page
        expect(ancestors.some((a) => a.includes("https") || a === "http://*.localhost:*" || a === "*")).toBe(false);
        // the same site's script tag, or a fetch, still isn't
        expect((await get(apps.port!, apps.url("framed"), { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "script", "Sec-Fetch-Mode": "no-cors" })).status).toBe(403);
        expect((await get(apps.port!, apps.url("framed"), { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "cors" })).status).toBe(403);
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
