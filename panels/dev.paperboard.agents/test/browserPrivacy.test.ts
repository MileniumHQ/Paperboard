import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { BROWSER_PROC_ID, BrowserComputer } from "../src/service/browser";
import { HomeFolder } from "../src/service/homeFolder";
import type { ComputerState } from "../src/contract";
import { fakeEnv, packageHost, Recorder, SLOW, tempDir, TestHost } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

/** A browser package whose program exits at once (it logs its argv), with a profile the user already has. */
function rig(platform: NodeJS.Platform) {
    const root = tempDir("browser-privacy");
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const helium = path.join(root, "packages", "helium");
    fs.mkdirSync(path.join(helium, "bin"), { recursive: true });
    fs.copyFileSync(path.join(import.meta.dir, "support", "fakeHelium.mjs"), path.join(helium, "bin", "helium"));
    const dir = path.join(root, "storage", "browser");
    fs.mkdirSync(path.join(dir, "profile", "Default"), { recursive: true });
    fs.writeFileSync(path.join(dir, "browser.json"), JSON.stringify({ version: 1, installed: true, chromium: 140 }));
    fs.writeFileSync(path.join(dir, "profile", "Default", "Preferences"), JSON.stringify({ helium: { services: { origin_override: "kept" } }, bookmarks: "kept" }));
    fs.writeFileSync(path.join(dir, "profile", "Local State"), JSON.stringify({ helium: { crash_reporting: { mode: 1 } }, browser: "kept" }));
    const host = new TestHost(fakeEnv(root));
    cleanups.push(() => host.close());
    const home = new HomeFolder(path.join(root, "storage", "home"));
    const computer = new BrowserComputer({ host: { ...host, packages: packageHost({ helium }) }, dir, home, storagePath: "browser", onState: new Recorder<ComputerState>().push, platform, arch: "x64" });
    cleanups.push(() => computer.shutdown());
    const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(dir, "profile", ...p), "utf8"));
    return { dir, host, computer, read };
}

// Helium's own reporting and cloud services never run for the agent's browser.
describe("the browser's privacy", () => {
    test("each start turns Helium's crash reporting and services off, keeping the rest of its settings", async () => {
        const { host, computer, read } = rig("linux");
        await expect(computer.init()).rejects.toThrow();
        expect(host.startedAs(BROWSER_PROC_ID)).toHaveLength(1);
        const state = read("Local State");
        expect(state.helium.crash_reporting.mode).toBe(-1);
        expect(state.browser).toBe("kept");
        const prefs = read("Default", "Preferences");
        expect(prefs.helium.services).toEqual({ origin_override: "kept", enabled: false });
        expect(prefs.helium.global_privacy_control).toBe(true);
        expect(prefs.bookmarks).toBe("kept");
        expect(host.startedAs(BROWSER_PROC_ID)[0]!.env).toBeUndefined();
    }, SLOW);

    test("on macOS the browser's Library is inside its own folder, not the user's", async () => {
        const { dir, host, computer } = rig("darwin");
        await expect(computer.init()).rejects.toThrow();
        const [launch] = host.startedAs(BROWSER_PROC_ID);
        expect(launch!.env).toEqual({ CFFIXED_USER_HOME: path.join(dir, "system") });
        expect(fs.statSync(path.join(dir, "system")).isDirectory()).toBe(true);
    }, SLOW);
});
