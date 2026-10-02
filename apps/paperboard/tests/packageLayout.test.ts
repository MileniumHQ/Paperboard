// Package archive layouts (bun test): registry records declare how an
// archive maps onto the package dir. Installs go through the real
// downloadPackage path against a loopback fixture registry: download,
// sha256 verification, extraction, index write.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { releaseMessage } from "../papercrane/releaseSignature";
import { fixtureSign, FIXTURE_RELEASE_PUBLIC_KEY } from "./registryFixture";
import { PaperCraneEngine } from "../papercrane/engine";

const key = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

let root = "";
let server: ReturnType<typeof Bun.serve>;
let base = "";
const archives = new Map<string, Buffer>();
const records = new Map<string, unknown>();
const archiveHits = new Map<string, number>();

const sha256 = (bytes: Buffer) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

// an Ollama-shaped tree: executable with its lib/ollama beside it
function writeTree(dir: string, withBin: boolean): void {
    const exeDir = withBin ? path.join(dir, "bin") : dir;
    const libDir = withBin ? path.join(dir, "lib", "ollama") : path.join(dir, "lib", "ollama");
    fs.mkdirSync(exeDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(exeDir, "tool"), "#!/bin/sh\necho ok\n", { mode: 0o755 });
    fs.writeFileSync(path.join(libDir, "backend.so"), "lib");
}

function publish(name: string, file: string, bytes: Buffer, layout?: unknown): string {
    archives.set(file, bytes);
    const digest = sha256(bytes);
    records.set(name, {
        name,
        version: "1.0.0",
        platforms: {
            [key]: {
                url: `${base}/dl/${file}`,
                sha256: digest,
                signature: fixtureSign(releaseMessage.package(name, "1.0.0", key, digest)),
                ...(layout === undefined ? {} : { layout }),
            },
        },
    });
    return digest;
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "package-layout-"));
    server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
            const { pathname } = new URL(request.url);
            const pkg = pathname.match(/^\/package\/(.+)\.json$/);
            if (pkg) {
                const record = records.get(decodeURIComponent(pkg[1]!));
                return record ? Response.json(record) : new Response("missing", { status: 404 });
            }
            const file = pathname.replace(/^\/dl\//, "");
            archiveHits.set(file, (archiveHits.get(file) ?? 0) + 1);
            const bytes = archives.get(file);
            return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
        },
    });
    base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
    await server.stop(true);
    fs.rmSync(root, { recursive: true, force: true });
});

function engine(): PaperCraneEngine {
    return new PaperCraneEngine(path.join(root, "host"), undefined, base, FIXTURE_RELEASE_PUBLIC_KEY);
}

describe("package archive layouts", () => {
    it("root: a zstd tarball whose root already holds bin/ installs as-is", async () => {
        const src = path.join(root, "src-root");
        writeTree(src, true);
        const tarball = path.join(root, "root.tar");
        await tar.c({ file: tarball, cwd: src }, ["bin", "lib"]);
        const digest = publish("rooted", "rooted.tar.zst", zlib.zstdCompressSync(fs.readFileSync(tarball)), "root");

        const e = engine();
        await e.downloadPackage("rooted", "dl-root", undefined, digest);
        const home = e.getPackagePath("rooted");
        expect(fs.readFileSync(path.join(home, "bin", "tool"), "utf8")).toContain("echo ok");
        // the sibling tree survives: bin/../lib/ollama is where the tool looks
        expect(fs.existsSync(path.join(home, "lib", "ollama", "backend.so"))).toBe(true);
        expect(e.getPackageIndex().rooted).toMatchObject({ version: "1.0.0", sha256: digest });
    });

    it("bin: a flat tgz becomes the package's bin/ with its layout intact", async () => {
        const src = path.join(root, "src-flat");
        writeTree(src, false);
        const tgz = path.join(root, "flat.tgz");
        await tar.c({ file: tgz, cwd: src, gzip: true }, ["tool", "lib"]);
        const digest = publish("flat", "flat.tgz", fs.readFileSync(tgz), "bin");

        const e = engine();
        await e.downloadPackage("flat", "dl-flat", undefined, digest);
        const home = e.getPackagePath("flat");
        expect(fs.existsSync(path.join(home, "bin", "tool"))).toBe(true);
        // exe-relative lib/ollama is preserved under bin/
        expect(fs.existsSync(path.join(home, "bin", "lib", "ollama", "backend.so"))).toBe(true);
        if (process.platform !== "win32") {
            expect(fs.statSync(path.join(home, "bin", "tool")).mode & 0o111).not.toBe(0);
        }
    });

    it("bin: a flat zip (Windows builds) becomes the package's bin/", async () => {
        const zip = new AdmZip();
        zip.addFile("tool.exe", Buffer.from("exe"));
        zip.addFile("lib/ollama/backend.dll", Buffer.from("dll"));
        const digest = publish("flatzip", "flatzip.zip", zip.toBuffer(), "bin");

        const e = engine();
        await e.downloadPackage("flatzip", "dl-zip", undefined, digest);
        const home = e.getPackagePath("flatzip");
        expect(fs.readFileSync(path.join(home, "bin", "tool.exe"), "utf8")).toBe("exe");
        expect(fs.existsSync(path.join(home, "bin", "lib", "ollama", "backend.dll"))).toBe(true);
    });

    it("without the layout field, a flat build is still refused (no bin/ was found)", async () => {
        const zip = new AdmZip();
        zip.addFile("tool.exe", Buffer.from("exe"));
        const digest = publish("legacyflat", "legacyflat.zip", zip.toBuffer());
        const e = engine();
        await expect(e.downloadPackage("legacyflat", "dl-legacy", undefined, digest)).rejects.toThrow(/no usable binary directory/);
        expect(e.getPackageIndex().legacyflat).toBeUndefined();
    });

    it("an unknown layout is refused before any bytes are downloaded", async () => {
        const digest = publish("oddlayout", "odd.tgz", Buffer.from("never fetched"), "sideways");
        const e = engine();
        await expect(e.downloadPackage("oddlayout", "dl-odd", undefined, digest)).rejects.toThrow(/Unsupported package layout/);
        expect(archiveHits.get("odd.tgz") ?? 0).toBe(0);
        expect(fs.existsSync(path.join(root, "host", "packages", "oddlayout"))).toBe(false);
    });
});

describe("package signatures", () => {
    it("refuses an unsigned or mis-signed platform entry before downloading it", async () => {
        const src = path.join(root, "unsigned-src");
        writeTree(src, true);
        const file = "unsigned.tar.gz";
        await tar.c({ file: path.join(root, file), cwd: src, gzip: true }, fs.readdirSync(src));
        const digest = publish("unsigned", file, fs.readFileSync(path.join(root, file)), "root");
        const record = records.get("unsigned") as any;
        delete record.platforms[key].signature;
        await expect(engine().downloadPackage("unsigned", "u1", undefined, digest)).rejects.toThrow(/not signed/);
        // a signature over another platform's entry does not cover this one
        record.platforms[key].signature = fixtureSign(releaseMessage.package("unsigned", "1.0.0", "other-x64", digest));
        await expect(engine().downloadPackage("unsigned", "u2", undefined, digest)).rejects.toThrow(/does not verify/);
        expect(archiveHits.get(file) ?? 0).toBe(0);
        expect(fs.existsSync(path.join(root, "host", "packages", "unsigned"))).toBe(false);
    });
});
