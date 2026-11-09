// Builds the real-browser fixture page against the published PaperUI build
// (dist/paperui.es.js and dist/paperui.css) and serves it from loopback for
// the Chrome suites in test/browser. Runs once per vitest run.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import solidPlugin from "vite-plugin-solid";
import type { TestProject } from "vitest/node";

declare module "vitest" {
    export interface ProvidedContext {
        /** http://127.0.0.1:<port> serving the fixture page */
        fixtureOrigin: string;
    }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = resolve(here, "../../..");
const dist = join(pkg, "dist");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
};

/** One second of 8 kHz mono 16-bit silence: a real, decodable WAV. */
function silentWav(): Buffer {
    const samples = 8000;
    const data = samples * 2;
    const wav = Buffer.alloc(44 + data);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36 + data, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(data, 40);
    return wav;
}

function sendMedia(req: IncomingMessage, res: ServerResponse, body: Buffer) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (!range) {
        res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": body.length, "Accept-Ranges": "bytes" });
        res.end(body);
        return;
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    res.writeHead(206, {
        "Content-Type": "audio/wav",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${body.length}`,
        "Accept-Ranges": "bytes",
    });
    res.end(body.subarray(start, end + 1));
}

export default async function setup(project: TestProject) {
    for (const file of ["paperui.es.js", "paperui.css"]) {
        if (!existsSync(join(dist, file))) {
            throw new Error(`PaperUI's build is missing ${join(dist, file)}: run \`bun run build\` in packages/paperui first`);
        }
    }

    const out = await mkdtemp(join(tmpdir(), "paperui-fixture-"));
    await build({
        configFile: false,
        root: join(here, "..", "fixture"),
        logLevel: "error",
        plugins: [solidPlugin()],
        resolve: {
            alias: [
                { find: /^@mileniumhq\/paperui\/style\.css$/, replacement: join(dist, "paperui.css") },
                { find: /^@mileniumhq\/paperui$/, replacement: join(dist, "paperui.es.js") },
            ],
        },
        build: { outDir: out, emptyOutDir: true, target: "esnext", minify: false, reportCompressedSize: false },
    });

    const wav = silentWav();
    // flaky media: the first request for an id fails, every later one succeeds
    const failedOnce = new Set<string>();
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/audio/tone.wav") return sendMedia(req, res, wav);
        if (url.pathname === "/audio/flaky.wav") {
            const id = url.searchParams.get("id") ?? "";
            if (!failedOnce.has(id)) {
                failedOnce.add(id);
                res.writeHead(404, { "Content-Type": "text/plain" }).end("not yet");
                return;
            }
            return sendMedia(req, res, wav);
        }
        const target = resolve(out, `.${url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)}`);
        if (!target.startsWith(out + sep)) {
            res.writeHead(403).end();
            return;
        }
        readFile(target).then(
            (body) => res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" }).end(body),
            (err: NodeJS.ErrnoException) => {
                if (err.code !== "ENOENT") console.error("[paperui fixture server]", err);
                res.writeHead(err.code === "ENOENT" ? 404 : 500).end(String(err.code));
            },
        );
    });
    await new Promise<void>((done, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => done());
    });
    const { port } = server.address() as AddressInfo;
    project.provide("fixtureOrigin", `http://127.0.0.1:${port}`);

    return async () => {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await rm(out, { recursive: true, force: true });
    };
}
