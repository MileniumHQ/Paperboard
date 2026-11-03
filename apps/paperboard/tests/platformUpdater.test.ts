// The app finds its updates. electron-updater took Paperboard's own cache
// folder adapter for a test double and left its HTTP client unset, so every
// update check of 0.3.0 failed with "Cannot read properties of null (reading
// 'request')" before it reached the feed.
import { afterEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// the binary itself: other suites stub the "electron" module
const ELECTRON_PACKAGE = path.dirname(require.resolve("electron/package.json"));
const ELECTRON = path.join(ELECTRON_PACKAGE, "dist", fs.readFileSync(path.join(ELECTRON_PACKAGE, "path.txt"), "utf8").trim());

const cleanup: (() => void)[] = [];
afterEach(() => {
    for (const step of cleanup.splice(0).reverse()) step();
});

const FEED_FILE =
    process.platform === "win32" ? "latest.yml"
    : process.platform === "darwin" ? "latest-mac.yml"
    : "latest-linux.yml";

describe("the app's update check", () => {
    it("reads the newest version from the update feed", async () => {
        const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(req) {
                if (new URL(req.url).pathname !== `/${FEED_FILE}`) return new Response("not found", { status: 404 });
                return new Response([
                    "version: 99.0.0",
                    "files:",
                    "  - url: paperboard-99.0.0.bin",
                    "    sha512: AAAA",
                    "    size: 1",
                    "path: paperboard-99.0.0.bin",
                    "sha512: AAAA",
                    "releaseDate: '2026-11-03T00:00:00.000Z'",
                ].join("\n"));
            },
        });
        cleanup.push(() => server.stop(true));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-updater-"));
        cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));

        const built = await Bun.build({
            entrypoints: [path.join(import.meta.dir, "fixtures", "updaterHost.ts")],
            target: "node",
            format: "cjs",
            external: ["electron"],
        });
        if (!built.success) throw new AggregateError(built.logs, "could not bundle the updater host");
        const host = path.join(dir, "host.js");
        fs.writeFileSync(host, await built.outputs[0]!.text());

        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(ELECTRON, [host, `http://127.0.0.1:${server.port}`, path.join(dir, "cache")], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        cleanup.push(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
        let log = "";
        child.stdout!.on("data", (d) => { log += d; });
        child.stderr!.on("data", (d) => { log += d; });
        await new Promise((resolve) => child.once("exit", resolve));

        expect(log).not.toContain("ERROR");
        const line = log.split("\n").find((l) => l.startsWith("RESULT "));
        expect(line, log).toBeDefined();
        expect(JSON.parse(line!.slice("RESULT ".length))).toEqual({ version: "99.0.0" });
    }, 60_000);
});
