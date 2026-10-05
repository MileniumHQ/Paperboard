// ensureElectron proofs (bun test): the "runtime binary is present?" contract
// electron-vite depends on (path.txt + matching dist/version + executable), and
// that ensureElectron runs electron's installer only when the binary is missing
// and verifies the result. Uses a throwaway electron dir with a stub install.js,
// so it never downloads a real binary.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { electronInstallState, ensureElectron } from "./ensureElectron";

const VERSION = "9.9.9";

// Stand-in for electron's install.js: produces the same markers (path.txt,
// dist/version, dist/<exe>) from the package version.
function writeStubInstaller(dir: string, version: string): void {
    writeFileSync(
        join(dir, "install.js"),
        "const fs=require('fs'),path=require('path');" +
            "fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});" +
            `fs.writeFileSync(path.join(__dirname,'dist','version'),'${version}');` +
            "fs.writeFileSync(path.join(__dirname,'dist','electron'),'');" +
            "fs.writeFileSync(path.join(__dirname,'path.txt'),'electron');",
    );
}

// Leaves the dir looking already installed, without running anything.
function markInstalled(dir: string, version = VERSION): void {
    writeFileSync(join(dir, "path.txt"), "electron");
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "version"), version);
    writeFileSync(join(dir, "dist", "electron"), "");
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ensure-electron-"));
    writeStubInstaller(dir, VERSION);
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("electronInstallState", () => {
    it("reports a missing path.txt first", () => {
        expect(electronInstallState(dir, VERSION)).toEqual({
            installed: false,
            reason: "path.txt is missing",
        });
    });

    it("reports a missing dist/version once path.txt exists", () => {
        writeFileSync(join(dir, "path.txt"), "electron");
        expect(electronInstallState(dir, VERSION)).toEqual({
            installed: false,
            reason: "dist/version is missing",
        });
    });

    it("rejects a version mismatch", () => {
        markInstalled(dir, "1.0.0");
        const state = electronInstallState(dir, VERSION);
        expect(state.installed).toBe(false);
        expect(state.reason).toContain("expected 9.9.9");
    });

    it("rejects a path.txt executable that is not on disk", () => {
        markInstalled(dir);
        rmSync(join(dir, "dist", "electron"));
        expect(electronInstallState(dir, VERSION)).toEqual({
            installed: false,
            reason: "dist/electron is missing",
        });
    });

    it("accepts path.txt + matching dist/version + executable", () => {
        markInstalled(dir);
        writeFileSync(join(dir, "dist", "version"), `v${VERSION}`);
        expect(electronInstallState(dir, VERSION)).toEqual({ installed: true, reason: "up to date" });
    });
});

describe("ensureElectron", () => {
    it("installs when the binary is missing and verifies the result", () => {
        expect(electronInstallState(dir, VERSION).installed).toBe(false);
        ensureElectron(dir, VERSION);
        expect(electronInstallState(dir, VERSION).installed).toBe(true);
        expect(existsSync(join(dir, "path.txt"))).toBe(true);
    });

    it("does not run the installer when the binary is already present", () => {
        markInstalled(dir);
        writeFileSync(join(dir, "install.js"), "process.exit(42)");
        expect(() => ensureElectron(dir, VERSION)).not.toThrow();
    });

    it("throws when the installer leaves the binary absent", () => {
        writeFileSync(join(dir, "install.js"), "process.exit(0)");
        expect(() => ensureElectron(dir, VERSION)).toThrow(/still missing/);
    });
});
