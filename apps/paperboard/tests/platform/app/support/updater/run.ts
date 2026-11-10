// Runs the app's updater in real Electron (entry.ts) against a loopback
// feed served the way i.paperboard.dev serves the electron-updater feeds.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { assetFileName, feedOf, ymlKeyFor } from "../../../../../../../scripts/publishLib";
import { APP_DIR, APP_PACKAGE, hostTarget } from "../build";
import { watch, WAIT_MS } from "../crane";
import { electronBinary } from "../electron";
import { ownChild, tempDataDir, tempDir } from "../temp";

let built: Promise<string> | null = null;
export function buildUpdaterApp(): Promise<string> {
    built ??= (async () => {
        const dir = tempDir("updater-app");
        const result = await Bun.build({
            entrypoints: [path.join(import.meta.dir, "entry.ts")],
            outdir: dir,
            naming: "main.js",
            target: "node",
            format: "cjs",
            packages: "external",
        });
        if (!result.success) throw new Error(`updater entry build failed:\n${result.logs.map(String).join("\n")}`);
        const { name, productName, version } = APP_PACKAGE;
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, productName, version, main: "main.js" }));
        fs.symlinkSync(path.join(APP_DIR, "node_modules"), path.join(dir, "node_modules"), "junction");
        return dir;
    })();
    return built;
}

// the feed file and the update payload this host's build asks for
export const FEED_FILE = ymlKeyFor(feedOf(hostTarget()));
export const PAYLOAD_FILE = assetFileName("pb", hostTarget());

export type Route = { body: Uint8Array | string } | { status: number } | "stall";

export class Feed {
    readonly requests: string[] = [];
    private routes = new Map<string, Route>();
    private stalled: Array<() => void> = [];
    private server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (req) => {
            const name = new URL(req.url).pathname.split("/").pop()!;
            this.requests.push(name);
            const route = this.routes.get(name);
            if (!route) return new Response("not found", { status: 404 });
            if (route === "stall") {
                // headers, then no bytes: a download that never finishes
                let open = true;
                const body = new ReadableStream({
                    start: (c) => { this.stalled.push(() => { if (open) c.close(); open = false; }); },
                    cancel: () => { open = false; },
                });
                return new Response(body, { headers: { "content-length": "1048576" } });
            }
            if ("status" in route) return new Response("refused", { status: route.status });
            return new Response(route.body);
        },
    });
    readonly url = `http://127.0.0.1:${this.server.port}/pb`;

    set(name: string, route: Route): void {
        this.routes.set(name, route);
    }

    // a latest*.yml offering `version` as `file`, with that file's sha512
    // (base64, as the publisher writes it) unless `sha512` overrides it
    offer(version: string, payload: Uint8Array, sha512 = crypto.createHash("sha512").update(payload).digest("base64")): void {
        this.set(FEED_FILE, { body: [
            `version: ${version}`,
            "files:",
            `  - url: ${PAYLOAD_FILE}`,
            `    sha512: ${sha512}`,
            `    size: ${payload.byteLength}`,
            `path: ${PAYLOAD_FILE}`,
            `sha512: ${sha512}`,
            `releaseDate: '2026-11-01T00:00:00.000Z'`,
        ].join("\n") });
    }

    private stopped = false;
    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        for (const close of this.stalled) close();
        this.server.stop(true);
    }
}

export interface UpdaterRun {
    results?: Array<{ status: string; version: string | null; error: string | null }>;
    shared?: boolean;
    states: Array<{ status: string; version: string | null; error: string | null }>;
    log: Array<{ level: string; message: string }>;
    crashed?: string;
    cacheDir: string;
}

export async function runUpdater(feed: Feed, options: { concurrent?: number; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<UpdaterRun> {
    const appDir = await buildUpdaterApp();
    const cacheDir = tempDir("updater-cache");
    // electron-builder.yml's publish entry, as electron-builder writes it
    // into the packaged app's app-update.yml
    fs.writeFileSync(path.join(appDir, "dev-app-update.yml"),
        `provider: generic\nurl: ${feed.url}\nchannel: latest\nupdaterCacheDirName: ${APP_PACKAGE.name}-updater\n`);
    const resultFile = path.join(tempDir("updater-result"), "result.json");
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env,
        PAPERBOARD_DIR: tempDataDir("updater-data"),
        PB_UPDATER: JSON.stringify({ cacheDir, resultFile, concurrent: options.concurrent ?? 1, timeoutMs: options.timeoutMs ?? WAIT_MS }),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronBinary(), [appDir, `--user-data-dir=${tempDir("updater-profile")}`], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    ownChild(child);
    const watched = watch(child, "updater electron");
    const timer = setTimeout(() => child.kill(), WAIT_MS * 2);
    const exit = await watched.exited;
    clearTimeout(timer);
    if (!fs.existsSync(resultFile)) throw new Error(`the updater wrote no result (exit ${JSON.stringify(exit)}):\n${watched.output()}`);
    return { ...JSON.parse(fs.readFileSync(resultFile, "utf8")), cacheDir };
}

// every file under dir
export function filesUnder(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
