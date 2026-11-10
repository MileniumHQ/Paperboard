import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUILD_TIMEOUT_MS, APP_PACKAGE } from "./support/build";
import { WAIT_MS } from "./support/crane";
import { buildUpdaterApp, Feed, FEED_FILE, filesUnder, PAYLOAD_FILE, runUpdater } from "./support/updater/run";
import { tempDir } from "./support/temp";

const NEWER = "99.0.0";
const payload = crypto.randomBytes(256 * 1024);

// The running install the updater must leave alone: an AppImage on Linux
// (electron-updater replaces process.env.APPIMAGE), elsewhere the app itself.
function runningInstall(): { env: Record<string, string>; file: string } {
    if (process.platform === "linux") {
        const file = path.join(tempDir("appimage"), "Paperboard.AppImage");
        fs.writeFileSync(file, crypto.randomBytes(4096));
        fs.chmodSync(file, 0o755);
        return { env: { APPIMAGE: file }, file };
    }
    return { env: {}, file: path.join(tempDir("install"), "unused") };
}

const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const downloaded = (cacheDir: string) => filesUnder(cacheDir).filter((f) => fs.readFileSync(f).equals(payload));

let feed: Feed;
afterEach(() => feed?.stop());
beforeAll(async () => {
    await buildUpdaterApp();
}, BUILD_TIMEOUT_MS);

// The app updates itself from a feed and refuses a bad update.
describe("app self-update from a feed", () => {
    test("a newer release in this target's feed is found, downloaded and its sha512 verified", async () => {
        feed = new Feed();
        feed.offer(NEWER, payload);
        feed.set(PAYLOAD_FILE, { body: payload });
        const install = runningInstall();
        const run = await runUpdater(feed, { env: install.env });
        expect(run.crashed).toBeUndefined();
        expect(feed.requests).toContain(FEED_FILE);
        expect(feed.requests).toContain(PAYLOAD_FILE);
        // the verified bytes are in the updater's cache
        expect(downloaded(run.cacheDir).length).toBeGreaterThan(0);
        const final = run.results![0];
        if (process.platform === "darwin") {
            // an unsigned build cannot hand the verified zip to Squirrel.Mac:
            // the native step refuses, and that is reported, not hidden
            expect(final.status).toBe("failed");
            expect(final.error).not.toMatch(/sha512/i);
        } else {
            expect(final).toMatchObject({ status: "ready", version: NEWER, error: null });
            // the stand-in AppImage carries no embedded blockmap, so the
            // updater says it takes the full download instead; nothing else
            const errors = run.log.filter((l) => l.level === "error" && !l.message.startsWith("Cannot download differentially, fallback to full download"));
            expect(errors).toEqual([]);
        }
    }, WAIT_MS * 3);

    test("a feed whose sha512 does not match the bytes is refused with the error shown, and the install is untouched", async () => {
        feed = new Feed();
        feed.offer(NEWER, payload, crypto.createHash("sha512").update("other bytes").digest("base64"));
        feed.set(PAYLOAD_FILE, { body: payload });
        const install = runningInstall();
        const before = fs.existsSync(install.file) ? digest(install.file) : null;
        const run = await runUpdater(feed, { env: install.env });
        expect(feed.requests).toContain(PAYLOAD_FILE);
        expect(run.results![0].status).toBe("failed");
        expect(run.results![0].error).toMatch(/sha512/i);
        expect(run.states.at(-1)).toMatchObject({ status: "failed" });
        expect(downloaded(run.cacheDir)).toEqual([]);
        if (before !== null) expect(digest(install.file)).toBe(before);
    }, WAIT_MS * 3);

    test("a feed offering an older or the same version offers nothing and downloads nothing", async () => {
        for (const version of ["0.1.0", APP_PACKAGE.version]) {
            feed = new Feed();
            feed.offer(version, payload);
            feed.set(PAYLOAD_FILE, { body: payload });
            const run = await runUpdater(feed, { env: runningInstall().env });
            expect(run.results![0]).toMatchObject({ status: "current", version: null, error: null });
            expect(feed.requests).toEqual([FEED_FILE]);
            feed.stop();
        }
    }, WAIT_MS * 3);
});
