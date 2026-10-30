import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { electronDataDir, moveElectronData } from "../src/main/electronData";

let root: string;
let legacy: string;
let target: string;
const savedDir = process.env.PAPERBOARD_DIR;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-electron-data-"));
    legacy = path.join(root, "config", "Paperboard");
    target = path.join(root, "paperboard", "local", "electron");
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
});

function writeLegacyProfile(): void {
    fs.mkdirSync(path.join(legacy, "Local Storage"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "Cookies"), "cookie-db");
    fs.writeFileSync(path.join(legacy, "Local Storage", "leveldb"), "ls");
}

describe("Electron data location", () => {
    it("lives in local/electron under the Paperboard directory", () => {
        process.env.PAPERBOARD_DIR = path.join(root, "paperboard");
        expect(electronDataDir()).toBe(target);
    });

    it("moves an older install's profile into place, whole", () => {
        writeLegacyProfile();
        expect(moveElectronData(legacy, target)).toBe("moved");
        expect(fs.existsSync(legacy)).toBe(false);
        expect(fs.readFileSync(path.join(target, "Cookies"), "utf8")).toBe("cookie-db");
        expect(fs.readFileSync(path.join(target, "Local Storage", "leveldb"), "utf8")).toBe("ls");
    });

    it("starts fresh when there is nothing to move", () => {
        expect(moveElectronData(legacy, target)).toBe("fresh");
        expect(fs.existsSync(target)).toBe(false);
    });

    it("never overwrites data already in place", () => {
        writeLegacyProfile();
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "Cookies"), "current");
        expect(moveElectronData(legacy, target)).toBe("current");
        expect(fs.readFileSync(path.join(target, "Cookies"), "utf8")).toBe("current");
        expect(fs.existsSync(path.join(legacy, "Cookies"))).toBe(true);
    });

    it.if(process.platform !== "win32")("leaves a profile an older Paperboard still has open", () => {
        writeLegacyProfile();
        fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(legacy, "SingletonLock"));
        expect(moveElectronData(legacy, target)).toBe("in-use");
        expect(fs.existsSync(path.join(legacy, "Cookies"))).toBe(true);
        expect(fs.existsSync(target)).toBe(false);
    });

    it.if(process.platform !== "win32")("moves a profile whose lock a crash left behind", () => {
        writeLegacyProfile();
        // pid_max is at most 2^22 on Linux and far lower on macOS
        fs.symlinkSync(`${os.hostname()}-${2 ** 22 + 1}`, path.join(legacy, "SingletonLock"));
        expect(moveElectronData(legacy, target)).toBe("moved");
        expect(fs.readFileSync(path.join(target, "Cookies"), "utf8")).toBe("cookie-db");
    });
});
