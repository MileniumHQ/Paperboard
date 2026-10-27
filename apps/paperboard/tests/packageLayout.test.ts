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
import { recipeDigest, parsePackageRecipe, assertRecipeRunsHere } from "../papercrane/packageRecipe";

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

function publish(name: string, file: string, bytes: Buffer, layout?: unknown, recipe?: unknown): string {
    archives.set(file, bytes);
    const digest = sha256(bytes);
    const recipeSha = recipe === undefined ? undefined : recipeDigest(parsePackageRecipe(recipe));
    records.set(name, {
        name,
        version: "1.0.0",
        platforms: {
            [key]: {
                url: `${base}/dl/${file}`,
                sha256: digest,
                signature: fixtureSign(releaseMessage.package(name, "1.0.0", key, digest, recipeSha)),
                ...(layout === undefined ? {} : { layout }),
                ...(recipe === undefined ? {} : { recipe }),
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

describe("package recipes", () => {
    it("zip: the vendor's wrapper folder becomes the package's bin/", async () => {
        const zip = new AdmZip();
        zip.addFile("helium_1_x64-windows/chrome.exe", Buffer.from("exe"));
        zip.addFile("helium_1_x64-windows/locales/en-US.pak", Buffer.from("pak"));
        const recipe = { unpack: "zip", take: { bin: "helium_1_x64-windows" } };
        // the URL says nothing about the format: the recipe does
        const digest = publish("zipped", "zipped-download", zip.toBuffer(), undefined, recipe);

        const e = engine();
        await e.downloadPackage("zipped", "dl-zipped", undefined, digest);
        const home = e.getPackagePath("zipped");
        expect(fs.readFileSync(path.join(home, "bin", "chrome.exe"), "utf8")).toBe("exe");
        expect(fs.existsSync(path.join(home, "bin", "locales", "en-US.pak"))).toBe(true);
        // the scratch tree is gone: only what the recipe took is installed
        expect(fs.readdirSync(home).sort()).toEqual(["bin"]);
        expect(e.getPackageIndex().zipped).toMatchObject({ version: "1.0.0", sha256: digest });
    });

    it.if(process.platform !== "win32")("tar.xz: decompressed by the system's xz, extracted by the bundled reader", async () => {
        const src = path.join(root, "src-xz");
        fs.mkdirSync(path.join(src, "helium-1-x86_64_linux"), { recursive: true });
        fs.writeFileSync(path.join(src, "helium-1-x86_64_linux", "helium"), "#!/bin/sh\necho ok\n", { mode: 0o755 });
        fs.writeFileSync(path.join(src, "README"), "not taken");
        const tarball = path.join(root, "xz.tar");
        await tar.c({ file: tarball, cwd: src }, ["helium-1-x86_64_linux", "README"]);
        const xz = Bun.spawnSync(["xz", "-zc", tarball]);
        expect(xz.exitCode).toBe(0);
        const recipe = { unpack: "tar.xz", take: { bin: "helium-1-x86_64_linux" } };
        const digest = publish("xzpkg", "xzpkg.tar.xz", Buffer.from(xz.stdout), undefined, recipe);

        const e = engine();
        await e.downloadPackage("xzpkg", "dl-xz", undefined, digest);
        const home = e.getPackagePath("xzpkg");
        const exe = path.join(home, "bin", "helium");
        expect(fs.readFileSync(exe, "utf8")).toContain("echo ok");
        expect(fs.statSync(exe).mode & 0o111).not.toBe(0);
        expect(fs.existsSync(path.join(home, "README"))).toBe(false);
        expect(fs.readdirSync(home).sort()).toEqual(["bin"]);
    });

    it("the signature covers the recipe: an entry signed for other steps is refused before downloading", async () => {
        const zip = new AdmZip();
        zip.addFile("app/tool.exe", Buffer.from("exe"));
        const file = "swapped.zip";
        const digest = publish("swapped", file, zip.toBuffer(), undefined, { unpack: "zip", take: { bin: "app" } });
        const entry = (records.get("swapped") as any).platforms[key];
        // the registry swaps in other steps under the same signature
        entry.recipe = { unpack: "zip", take: { "bin/elsewhere": "app" } };
        await expect(engine().downloadPackage("swapped", "dl-swap", undefined, digest)).rejects.toThrow(/does not verify/);
        // and a daemon signing check without the recipe (an old daemon) refuses a recipe entry too
        entry.recipe = { unpack: "zip", take: { bin: "app" } };
        entry.signature = fixtureSign(releaseMessage.package("swapped", "1.0.0", key, digest));
        await expect(engine().downloadPackage("swapped", "dl-swap2", undefined, digest)).rejects.toThrow(/does not verify/);
        expect(archiveHits.get(file) ?? 0).toBe(0);
    });

    it("a recipe entry that also declares a layout is refused", async () => {
        const digest = publish("both", "both.zip", Buffer.from("never fetched"), "bin", { unpack: "zip", take: { bin: "x" } });
        await expect(engine().downloadPackage("both", "dl-both", undefined, digest)).rejects.toThrow(/cannot also declare a layout/);
        expect(archiveHits.get("both.zip") ?? 0).toBe(0);
    });

    it("an unknown unpack step is refused before any bytes are downloaded", async () => {
        const digest = sha256(Buffer.from("never fetched"));
        archives.set("odd.pkg", Buffer.from("never fetched"));
        records.set("oddrecipe", {
            name: "oddrecipe",
            version: "1.0.0",
            platforms: { [key]: { url: `${base}/dl/odd.pkg`, sha256: digest, signature: "x", recipe: { unpack: "sh", take: { bin: "x" } } } },
        });
        await expect(engine().downloadPackage("oddrecipe", "dl-oddr", undefined, digest)).rejects.toThrow(/Unsupported package recipe unpack/);
        expect(archiveHits.get("odd.pkg") ?? 0).toBe(0);
    });

    it.if(process.platform !== "darwin")("a disk image is refused off macOS before any bytes are downloaded", async () => {
        const digest = publish("image", "image.dmg", Buffer.from("never fetched"), undefined, { unpack: "dmg", take: { "bin/App.app": "App.app" } });
        await expect(engine().downloadPackage("image", "dl-dmg", undefined, digest)).rejects.toThrow(/only macOS/);
        expect(archiveHits.get("image.dmg") ?? 0).toBe(0);
        expect(fs.existsSync(path.join(root, "host", "packages", "image"))).toBe(false);
    });

    it("a source missing from the archive fails the install and leaves nothing behind", async () => {
        const zip = new AdmZip();
        zip.addFile("other/tool.exe", Buffer.from("exe"));
        const digest = publish("missing", "missing.zip", zip.toBuffer(), undefined, { unpack: "zip", take: { bin: "app" } });
        const e = engine();
        await expect(e.downloadPackage("missing", "dl-missing", undefined, digest)).rejects.toThrow(/source app is not in the archive/);
        expect(e.getPackageIndex().missing).toBeUndefined();
        const left = fs.readdirSync(path.join(root, "host", "packages")).filter((f) => f.startsWith("missing"));
        expect(left).toEqual([]);
    });

    it.if(process.platform !== "win32")("a source that leaves the archive through a symlink is refused", async () => {
        const src = path.join(root, "src-link");
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, "tool"), "x");
        // a link to its own sibling passes the tar guard; the take must still stay inside the tree
        fs.symlinkSync("..", path.join(src, "up"));
        const tarball = path.join(root, "link.tar");
        await tar.c({ file: tarball, cwd: src }, ["tool", "up"]);
        const digest = publish("linked", "linked.tar", fs.readFileSync(tarball), undefined, { unpack: "tar", take: { bin: "up" } });
        await expect(engine().downloadPackage("linked", "dl-link", undefined, digest)).rejects.toThrow(/escapes destination|leaves the archive/);
    });

    it("recipes are plain data: paths that climb, absolute paths and empty takes are refused", () => {
        expect(() => parsePackageRecipe({ unpack: "zip", take: { bin: "../x" } })).toThrow(/plain relative path/);
        expect(() => parsePackageRecipe({ unpack: "zip", take: { "/bin": "x" } })).toThrow(/plain relative path/);
        expect(() => parsePackageRecipe({ unpack: "zip", take: {} })).toThrow(/1 to 16/);
        expect(() => parsePackageRecipe({ unpack: "zip", take: { lib: "x" } })).toThrow(/bin\//);
        expect(() => parsePackageRecipe({ unpack: "zip", take: { bin: "a", "bin/b": "b" } })).toThrow(/overlap/);
        expect(() => parsePackageRecipe({ unpack: "zip", take: { bin: "a" }, run: "x" })).toThrow(/unknown fields/);
        expect(() => assertRecipeRunsHere({ unpack: "dmg", take: { bin: "a" } }, "linux")).toThrow(/only macOS/);
        expect(() => assertRecipeRunsHere({ unpack: "dmg", take: { bin: "a" } }, "darwin")).not.toThrow();
        // the digest does not depend on key order
        expect(recipeDigest({ unpack: "zip", take: { bin: "a", "lib/x": "b" } })).toBe(recipeDigest({ unpack: "zip", take: { "lib/x": "b", bin: "a" } }));
    });
});
