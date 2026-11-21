import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fetchRegistryJson } from "../src/registryFetch";
import {
    loadInstalledPanelMedia,
    parseStoreListing,
    parseStoreManifest,
    readStoreFiles,
    STORE_MAX_ABOUT_BYTES,
    STORE_MAX_SCREENSHOT_BYTES,
} from "../src/storeListing";

const servers: http.Server[] = [];

async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

async function failure(promise: Promise<unknown>): Promise<Error & { status?: number }> {
    return promise.then(
        () => {
            throw new Error("expected a rejection");
        },
        (err: Error) => err,
    );
}

// Untrusted registry and listing input is bounded.
describe("untrusted registry and listing input is bounded", () => {
    test("an HTTP error rejects with its status and no fallback", async () => {
        const url = await serve((_req, res) => {
            res.writeHead(503);
            res.end("{}");
        });
        const err = await failure(fetchRegistryJson(`${url}/panels/index.json`));
        expect(err.message).toBe("Registry returned HTTP 503");
        expect(err.status).toBe(503);
    });

    test("fetchRegistryIndex reads REGISTRY_URL and rejects its HTTP error", async () => {
        const url = await serve((req, res) => {
            res.writeHead(req.url === "/panels/index.json" ? 404 : 500);
            res.end();
        });
        // REGISTRY_URL is read once, when the SDK loads, so a fresh process sees the override
        const script = `import { fetchRegistryIndex } from ${JSON.stringify(join(import.meta.dir, "..", "src", "config.ts"))};
fetchRegistryIndex().then((v) => { console.log("RESOLVED", JSON.stringify(v)); }, (e) => { console.log("REJECTED", e.message, e.status); });`;
        const out = await new Promise<string>((resolve, reject) => {
            const child = spawn(process.execPath, ["-e", script], { env: { ...process.env, ORIGAMI_REGISTRY_URL: url }, stdio: ["ignore", "pipe", "inherit"] });
            let text = "";
            child.stdout.on("data", (c: Buffer) => {
                text += c.toString();
            });
            child.once("error", reject);
            child.once("close", () => resolve(text.trim()));
        });
        expect(out).toBe("REJECTED Registry returned HTTP 404 404");
    });

    test("a declared size over the cap is refused before the body is buffered", async () => {
        const url = await serve((_req, res) => {
            res.writeHead(200, { "content-type": "application/json", "content-length": String(10_000) });
            // a few bytes, then nothing: a client that buffers would wait for the rest
            res.write("{");
        });
        const err = await failure(fetchRegistryJson(url, 60_000, 1024));
        expect(err.message).toBe("Registry index exceeds 1024 bytes; refusing to parse");
    });

    test("a body that grows past the cap without a declared size is cut off as it streams", async () => {
        const url = await serve((_req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            // chunked, no content-length, and never finished
            res.write(`[${'"x",'.repeat(400)}`);
        });
        const err = await failure(fetchRegistryJson(url, 60_000, 1024));
        expect(err.message).toBe("Registry index exceeds 1024 bytes; refusing to parse");
    });

    test("a hung fetch is aborted at its deadline", async () => {
        const url = await serve(() => {
            // accepts the request and never answers
        });
        const err = await failure(fetchRegistryJson(url, 100));
        expect(err.name).toBe("AbortError");
    });

    test("parseStoreManifest refuses paths outside store/, traversal, absolute paths and svg screenshots", () => {
        const bad = [
            { about: "./README.md" },
            { about: "./store/../secret.md" },
            { about: "/etc/passwd.md" },
            { about: "store/about.txt" },
            { screenshots: [{ light: "./store/shot.svg" }] },
            { screenshots: [{ light: "../store/shot.png" }] },
            { screenshots: [{ light: "./store/a.png", dark: "C:/shot.png" }] },
            { screenshots: [{ light: "./store/sub/../../x.png" }] },
        ];
        for (const store of bad) expect(() => parseStoreManifest(store)).toThrow(/store\./);
        expect(parseStoreManifest({ about: "./store/about.md", screenshots: [{ light: "./store/1-light.png", dark: "store/1-dark.webp", alt: "Chat" }] })).toEqual({
            about: "./store/about.md",
            screenshots: [{ light: "./store/1-light.png", dark: "store/1-dark.webp", alt: "Chat" }],
            services: [],
            credits: [],
            requirements: [],
        });
    });

    test("a listing keeps every row the manifest and the registry hand it", () => {
        const services = Array.from({ length: 40 }, (_, i) => ({ name: `Service ${i}`, detail: "Detail" }));
        expect(parseStoreManifest({ services })?.services).toEqual(services);
        expect(parseStoreListing({ services })?.services).toEqual(services);
    });

    test("parseStoreListing drops javascript: and protocol-relative URLs", () => {
        const listing = parseStoreListing({
            screenshots: [
                { light: "javascript:alert(1)" },
                { light: "//evil.example/x.png" },
                { light: "https://i.example/a.png", dark: "javascript:alert(2)" },
                { light: "/media/b.png", dark: "//evil.example/d.png" },
                { light: "data:image/svg+xml;base64,PHN2Zz4=" },
            ],
        });
        expect(listing?.screenshots).toEqual([{ light: "https://i.example/a.png" }, { light: "/media/b.png" }]);
    });

    // One reader serves the publisher and installed panels, so a cap holds for both.
    test("readStoreFiles reads every named file under its cap, and installed media turns them into data URLs", async () => {
        const files: Record<string, Uint8Array> = {
            "store/about.md": new TextEncoder().encode("# About\n"),
            "store/1-light.png": new Uint8Array([1, 2, 3]),
            "store/1-dark.webp": new Uint8Array([4]),
        };
        const read = async (path: string) => {
            const bytes = files[path.replace(/^\.\//, "")];
            if (!bytes) throw new Error(`ENOENT: ${path}`);
            return bytes;
        };
        const store = { about: "./store/about.md", screenshots: [{ light: "./store/1-light.png", dark: "store/1-dark.webp", alt: "Chat" }] };

        expect(await readStoreFiles(undefined, read)).toBeNull();
        const read1 = await readStoreFiles(store, read);
        expect(read1?.about).toBe("# About\n");
        expect(read1?.screenshots).toEqual([
            {
                light: { path: "./store/1-light.png", type: "image/png", bytes: files["store/1-light.png"]! },
                dark: { path: "store/1-dark.webp", type: "image/webp", bytes: files["store/1-dark.webp"]! },
                alt: "Chat",
            },
        ]);
        expect(read1?.services).toEqual([]);

        files["manifest.json"] = new TextEncoder().encode(JSON.stringify({ store }));
        expect((await loadInstalledPanelMedia(read, true)).store).toEqual({
            about: "# About\n",
            screenshots: [{ light: "data:image/png;base64,AQID", dark: "data:image/webp;base64,BA==", alt: "Chat" }],
            services: [],
            credits: [],
            requirements: [],
        });

        await expect(readStoreFiles({ about: "./store/missing.md" }, read)).rejects.toThrow("ENOENT");
        files["store/1-light.png"] = new Uint8Array(STORE_MAX_SCREENSHOT_BYTES + 1);
        await expect(readStoreFiles(store, read)).rejects.toThrow(`over the ${STORE_MAX_SCREENSHOT_BYTES}-byte cap`);
        files["store/1-light.png"] = new Uint8Array([1]);
        files["store/about.md"] = new Uint8Array(STORE_MAX_ABOUT_BYTES + 1);
        await expect(readStoreFiles(store, read)).rejects.toThrow(`over the ${STORE_MAX_ABOUT_BYTES}-byte cap`);
    });
});
