import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { AppUpdateSession } from "../../src/main/appUpdateSession";
import { ManualAppUpdater } from "../../src/main/manualAppUpdater";
import { linuxPackageInstall } from "../../src/main/linuxPackageInstall";
import { APP_PACKAGE, BUILD_TIMEOUT_MS } from "../platform/app/support/build";
import { WAIT_MS } from "../platform/app/support/crane";
import { buildUpdaterApp, Feed, FEED_FILE, PAYLOAD_FILE, runUpdater } from "../platform/app/support/updater/run";
import { tempDir } from "../platform/app/support/temp";

const NEWER = "99.0.0";
const payload = crypto.randomBytes(64 * 1024);
// the updater only replaces an AppImage; this stand-in is never run
function appImage(): Record<string, string> {
    const file = path.join(tempDir("appimage"), "Paperboard.AppImage");
    fs.writeFileSync(file, crypto.randomBytes(1024));
    return { APPIMAGE: file };
}

let feed: Feed;
afterEach(() => feed?.stop());
beforeAll(async () => {
    await buildUpdaterApp();
}, BUILD_TIMEOUT_MS);

// The desktop app can check for and report its own updates.
describe("desktop app update checks", () => {
    test("in real Electron the updater reads the feed and logs no error", async () => {
        feed = new Feed();
        feed.offer(APP_PACKAGE.version, payload);
        const run = await runUpdater(feed, { env: appImage() });
        expect(run.crashed).toBeUndefined();
        expect(feed.requests).toEqual([FEED_FILE]);
        expect(run.results![0]).toMatchObject({ status: "current", error: null });
        expect(run.log.filter((l) => l.level === "error" || l.level === "warn")).toEqual([]);
    }, WAIT_MS * 2);

    test("checks made at once share one", async () => {
        feed = new Feed();
        feed.offer(APP_PACKAGE.version, payload);
        const run = await runUpdater(feed, { env: appImage(), concurrent: 3 });
        expect(run.shared).toBe(true);
        expect(feed.requests).toEqual([FEED_FILE]);
    }, WAIT_MS * 2);

    test("a refused or timed-out download is failed, never up to date", async () => {
        feed = new Feed();
        feed.offer(NEWER, payload);
        feed.set(PAYLOAD_FILE, { status: 503 });
        const refused = await runUpdater(feed, { env: appImage() });
        expect(refused.results![0]).toMatchObject({ status: "failed", version: NEWER });
        expect(refused.results![0].error).toMatch(/503/);
        expect(refused.states.map((s) => s.status)).not.toContain("current");
        feed.stop();

        feed = new Feed();
        feed.offer(NEWER, payload);
        feed.set(PAYLOAD_FILE, "stall");
        const stalled = await runUpdater(feed, { env: appImage(), timeoutMs: 2000 });
        expect(stalled.results![0]).toMatchObject({ status: "failed", error: "The app update timed out. Check your connection and try again." });
        expect(stalled.states.map((s) => s.status)).not.toContain("current");
    }, WAIT_MS * 3);

    test("a native activation error after the download stays failed", async () => {
        // electron-updater's events, in the order Squirrel.Mac gives them when
        // it refuses the verified download
        class NativeRefusal extends EventEmitter {
            async checkForUpdates() {
                this.emit("update-available", { version: NEWER });
                this.emit("update-downloaded", { version: NEWER });
                this.emit("error", new Error("Could not get code signature for running application"));
                this.emit("update-not-available", {});
                return { downloadPromise: Promise.resolve() };
            }
        }
        const states: string[] = [];
        const session = new AppUpdateSession(new NativeRefusal(), (s) => states.push(s.status), WAIT_MS);
        const final = await session.check();
        expect(final).toMatchObject({ status: "failed", error: "Could not get code signature for running application" });
        expect(states).toEqual(["checking", "downloading", "ready", "failed"]);
        session.dispose();
    });

    test("a deb or rpm install is offered its own package and fetches only the feed", async () => {
        for (const [type, arch, feedFile, download] of [
            ["deb", "x64", "latest-linux.yml", "https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb"],
            ["rpm", "arm64", "latest-linux-arm64.yml", "https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.rpm"],
        ] as const) {
            const resources = tempDir("resources");
            fs.writeFileSync(path.join(resources, "package-type"), `${type}\n`);
            expect(linuxPackageInstall(resources, arch)).toEqual({ feedUrl: `https://i.paperboard.dev/pb/${feedFile}`, download, packageType: type });
        }
        // a package Paperboard didn't publish has nothing of ours to download or install
        expect(linuxPackageInstall(tempDir("resources"), "x64")).toMatchObject({ download: null, packageType: null });

        feed = new Feed();
        feed.offer(NEWER, payload);
        feed.set(PAYLOAD_FILE, { body: payload });
        const session = new AppUpdateSession(new ManualAppUpdater(APP_PACKAGE.version, `${feed.url}/${FEED_FILE}`), () => undefined, WAIT_MS, "package-download");
        expect(await session.check()).toMatchObject({ status: "manual", installMode: "package-download", version: NEWER, error: null });
        expect(feed.requests).toEqual([FEED_FILE]);
        session.dispose();
    });
});
