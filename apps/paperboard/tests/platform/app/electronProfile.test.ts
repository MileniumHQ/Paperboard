import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { moveElectronData } from "../../../src/main/electronData";
import { BUILD_TIMEOUT_MS, buildApp, type BuiltApp } from "./support/build";
import { WAIT_MS } from "./support/crane";
import { launchElectron, shellReady } from "./support/electron";
import { tempDataDir, tempDir } from "./support/temp";

// a Chromium profile's shape: nested stores, binary files
function writeProfile(dir: string): Record<string, string> {
    const files: Record<string, string> = {
        "Preferences": `{"profile":{"name":"older install"}}`,
        "Cookies": "\u0000SQLite format 3\u0000cookie rows",
        [path.join("Local Storage", "leveldb", "000003.log")]: "shell state",
        [path.join("Local Storage", "leveldb", "CURRENT")]: "MANIFEST-000001\n",
        [path.join("paperboard-updater", "pending", "update-info.json")]: `{"fileName":"x"}`,
    };
    for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
    }
    return files;
}

function readTree(dir: string, base = dir): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) Object.assign(out, readTree(full, base));
        else if (entry.isFile()) out[path.relative(base, full)] = fs.readFileSync(full, "utf8");
    }
    return out;
}

const targetIn = (dataDir: string) => path.join(dataDir, "local", "electron");

let app: BuiltApp;
beforeAll(async () => {
    app = await buildApp();
}, BUILD_TIMEOUT_MS);

// Electron's profile moves to `local/electron` without loss.
describe("Electron profile move", () => {
    test("an older install's profile moves whole, and a fresh install has nothing to move", () => {
        const legacy = path.join(tempDir("legacy-profile"), "Paperboard");
        const files = writeProfile(legacy);
        const to = targetIn(tempDataDir("profile-move"));
        expect(moveElectronData(legacy, to)).toBe("moved");
        expect(readTree(to)).toEqual(files);
        expect(fs.existsSync(legacy)).toBe(false);

        expect(moveElectronData(path.join(tempDir("none"), "Paperboard"), targetIn(tempDataDir("profile-fresh")))).toBe("fresh");
    });

    test("data already at the target is never overwritten", () => {
        const legacy = path.join(tempDir("legacy-profile"), "Paperboard");
        const old = writeProfile(legacy);
        const to = targetIn(tempDataDir("profile-current"));
        fs.mkdirSync(to, { recursive: true });
        fs.writeFileSync(path.join(to, "Preferences"), `{"profile":{"name":"current"}}`);
        expect(moveElectronData(legacy, to)).toBe("current");
        expect(readTree(to)).toEqual({ Preferences: `{"profile":{"name":"current"}}` });
        expect(readTree(legacy)).toEqual(old);
    });

    test("a profile a running Paperboard holds open is left alone, and moves once it closes", async () => {
        const legacy = path.join(tempDir("legacy-profile"), "Paperboard");
        writeProfile(legacy);
        const dataDir = tempDataDir("profile-live");
        const to = targetIn(tempDataDir("profile-target"));
        // a real Electron with that profile open
        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"], userDataDir: legacy });
        await shellReady(electron);
        if (process.platform === "win32") {
            // Windows has no SingletonLock symlink: the open profile itself
            // refuses the rename, and nothing is moved
            expect(() => moveElectronData(legacy, to)).toThrow();
        } else {
            // SingletonLock names a live pid on this host
            expect(fs.readlinkSync(path.join(legacy, "SingletonLock"))).toBe(`${os.hostname()}-${electron.child.pid}`);
            expect(moveElectronData(legacy, to)).toBe("in-use");
        }
        expect(fs.existsSync(to)).toBe(false);
        // Chromium keeps writing its own files; ours are where they were
        expect(fs.readFileSync(path.join(legacy, "paperboard-updater", "pending", "update-info.json"), "utf8")).toBe(`{"fileName":"x"}`);
        expect(await electron.quit()).toEqual({ code: 0, signal: null });

        const closed = readTree(legacy);
        expect(moveElectronData(legacy, to)).toBe("moved");
        expect(readTree(to)).toEqual(closed);
    }, WAIT_MS * 2);

    if (process.platform !== "win32") {
        test("a lock left by a crashed Paperboard does not keep the profile from moving", () => {
            const legacy = path.join(tempDir("legacy-profile"), "Paperboard");
            const files = writeProfile(legacy);
            // a pid that has exited
            const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
            fs.symlinkSync(`${os.hostname()}-${gone}`, path.join(legacy, "SingletonLock"));
            const to = targetIn(tempDataDir("profile-stale"));
            expect(moveElectronData(legacy, to)).toBe("moved");
            expect(readTree(to)).toEqual(files);
            expect(fs.readlinkSync(path.join(to, "SingletonLock"))).toBe(`${os.hostname()}-${gone}`);
        });
    }
});
