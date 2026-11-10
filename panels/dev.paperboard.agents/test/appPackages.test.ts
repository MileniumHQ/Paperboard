import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { Apps } from "../src/service/apps";
import { HomeFolder } from "../src/service/homeFolder";
import { tempDir } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

interface TarEntry {
    name: string;
    data?: string;
    /** "0" a file, "2" a symlink, "5" a folder */
    type?: string;
    link?: string;
}

/** A real .tgz, as npm packs one: ustar headers, 512-byte blocks, gzip. */
function tgz(entries: TarEntry[]): Buffer {
    const blocks: Buffer[] = [];
    for (const e of entries) {
        const data = Buffer.from(e.data ?? "");
        const h = Buffer.alloc(512);
        h.write(e.name, 0, 100, "utf8");
        h.write("0000644\0", 100);
        h.write("0000000\0", 108);
        h.write("0000000\0", 116);
        h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
        h.write("00000000000\0", 136);
        h.write(e.type ?? "0", 156);
        if (e.link) h.write(e.link, 157, 100);
        h.write("ustar\0", 257);
        h.write("00", 263);
        h.fill(" ", 148, 156);
        let sum = 0;
        for (const b of h) sum += b;
        h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
        blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return zlib.gzipSync(Buffer.concat(blocks));
}

const sha512 = (b: Buffer) => `sha512-${createHash("sha512").update(b).digest("base64")}`;
const pkgJson = (name: string, version: string) => JSON.stringify({ name, version });

/** The npm registry on loopback: packuments and tarballs, every request logged. */
async function registry(packages: Record<string, { version: string; tarball: Buffer; integrity?: string; tarballUrl?: string }>) {
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url!);
        const name = decodeURIComponent(req.url!.slice(1));
        const p = packages[name];
        if (p) {
            const tarball = p.tarballUrl ?? `${base}/${name}/-/${name}-${p.version}.tgz`;
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ "dist-tags": { latest: p.version }, versions: { [p.version]: { version: p.version, dist: { tarball, integrity: p.integrity ?? sha512(p.tarball) } } } }));
        }
        const m = req.url!.match(/^\/([^/]+)\/-\//);
        if (m && packages[m[1]!]) return res.writeHead(200).end(packages[m[1]!]!.tarball);
        res.writeHead(404).end("{}");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cleanups.push(() => new Promise<void>((ok) => server.close(() => ok())));
    return { base, requests };
}

async function app(registryUrl: string) {
    const root = tempDir("packages");
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const home = new HomeFolder(path.join(root, "home"));
    home.ensure();
    const apps = new Apps({ home, portFile: path.join(root, "apps.json"), infoFile: path.join(root, "info.json"), picturesDir: path.join(root, "pics"), registry: registryUrl, picture: async () => "", post: () => {}, onChange: () => {} });
    cleanups.push(() => apps.close());
    const tools = apps.toolset();
    await tools.call("start_app", { name: "planner", title: "Planner", description: "plans" }, { fromFlow: false });
    const dir = path.join(home.root, "Apps", "planner");
    const add = (packages: string[]) => tools.call("add_package", { app: "planner", packages }, { fromFlow: false });
    /** every file under the temp root, for "nothing was written" */
    const everything = () => (fs.readdirSync(root, { recursive: true }) as string[]).map(String).sort();
    return { root, dir, add, everything };
}

const good = tgz([
    { name: "package/package.json", data: pkgJson("tiny", "1.0.0") },
    { name: "package/index.js", data: "export default 1;" },
    { name: "package/evil-link", type: "2", link: "/etc/passwd" },
]);

// Package installs are verified and contained.
describe("add_package", () => {
    test("installs a package checked against its sha512, dropping links", async () => {
        const reg = await registry({ tiny: { version: "1.0.0", tarball: good } });
        const a = await app(reg.base);
        const r = await a.add(["tiny"]);
        expect(r.isError).toBeFalsy();
        expect(fs.readFileSync(path.join(a.dir, "node_modules", "tiny", "index.js"), "utf8")).toBe("export default 1;");
        expect(fs.existsSync(path.join(a.dir, "node_modules", "tiny", "evil-link"))).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(a.dir, "package.json"), "utf8")).dependencies).toEqual({ tiny: "^1.0.0" });
    });

    test("git, file and URL specs are refused, and only the registry is ever asked", async () => {
        const reg = await registry({ tiny: { version: "1.0.0", tarball: good } });
        const a = await app(reg.base);
        const before = fs.readFileSync(path.join(a.dir, "package.json"), "utf8");
        for (const spec of ["git+https://github.com/x/y.git", "github:x/y", "file:../evil", "../evil", "https://evil.example/x.tgz", "tiny@file:../x", "tiny@git+https://github.com/x/y.git", "tiny@https://evil.example/x.tgz"]) {
            const r = await a.add([spec]);
            expect(r.isError).toBe(true);
        }
        expect(reg.requests.every((u) => u === "/tiny")).toBe(true);
        expect(fs.existsSync(path.join(a.dir, "node_modules"))).toBe(false);
        expect(fs.readFileSync(path.join(a.dir, "package.json"), "utf8")).toBe(before);
    });

    test("a tarball whose sha512 doesn't match, or that's served from elsewhere, installs nothing and changes nothing", async () => {
        const reg = await registry({ tiny: { version: "1.0.0", tarball: good } });
        const a = await app(reg.base);
        expect((await a.add(["tiny"])).isError).toBeFalsy();
        const pj = fs.readFileSync(path.join(a.dir, "package.json"), "utf8");
        const files = a.everything();

        const tampered = tgz([{ name: "package/package.json", data: pkgJson("other", "2.0.0") }, { name: "package/index.js", data: "steal()" }]);
        const bad = await registry({ other: { version: "2.0.0", tarball: tampered, integrity: sha512(Buffer.from("what the registry published")) } });
        const b = await app(bad.base);
        fs.cpSync(path.join(a.dir, "node_modules"), path.join(b.dir, "node_modules"), { recursive: true });
        const r = await b.add(["other"]);
        expect(r).toMatchObject({ isError: true, text: "other@2.0.0 doesn't match the registry's checksum; nothing was installed" });
        expect(fs.readdirSync(path.join(b.dir, "node_modules"))).toEqual(["tiny"]);
        expect(JSON.parse(fs.readFileSync(path.join(b.dir, "package.json"), "utf8")).dependencies).toEqual({});

        const away = await registry({ other: { version: "2.0.0", tarball: tampered, tarballUrl: "http://127.0.0.1:9/other.tgz" } });
        const c = await app(away.base);
        expect(await c.add(["other"])).toMatchObject({ isError: true, text: "other@2.0.0 is served from outside the npm registry" });
        expect(fs.existsSync(path.join(c.dir, "node_modules"))).toBe(false);
        // the first app was never touched by the others
        expect(fs.readFileSync(path.join(a.dir, "package.json"), "utf8")).toBe(pj);
        expect(a.everything()).toEqual(files);
    });

    test("an entry escaping the package aborts with nothing written outside", async () => {
        const escaping = tgz([
            { name: "package/package.json", data: pkgJson("sneaky", "1.0.0") },
            { name: "package/../../../../escape.txt", data: "pwned" },
        ]);
        const reg = await registry({ sneaky: { version: "1.0.0", tarball: escaping } });
        const a = await app(reg.base);
        const before = a.everything();
        const r = await a.add(["sneaky"]);
        expect(r.isError).toBe(true);
        expect(r.text).toContain("can't be unpacked safely");
        expect(a.everything()).toEqual(before);
        expect(fs.existsSync(path.join(path.dirname(a.root), "escape.txt"))).toBe(false);
    });
});
