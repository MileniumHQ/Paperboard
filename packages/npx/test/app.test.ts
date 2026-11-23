// The launcher opens Paperboard where the install scripts put it.
import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { installedAppCandidates } from "../src/app";

const INSTALL_DIR = path.join(import.meta.dir, "..", "install");

describe("the launcher and the install scripts agree on where Paperboard is", () => {
    test("every place the launcher looks is a place a script installs to", () => {
        const sh = fs.readFileSync(path.join(INSTALL_DIR, "install.sh"), "utf8");
        const ps1 = fs.readFileSync(path.join(INSTALL_DIR, "install.ps1"), "utf8");
        expect(installedAppCandidates("darwin")).toEqual(["/Applications/Paperboard.app"]);
        expect(sh).toContain("target=/Applications/Paperboard.app");
        const [opt, appimage] = installedAppCandidates("linux", {}, "/home/me");
        expect(opt).toBe("/opt/Paperboard/paperboard");
        expect(appimage).toBe("/home/me/.local/share/paperboard/Paperboard.AppImage");
        expect(sh).toContain('dir="$data/paperboard"');
        expect(sh).toContain('appimage="$dir/Paperboard.AppImage"');
        expect(installedAppCandidates("win32", { LOCALAPPDATA: "C:\\L" })[0]).toBe(path.join("C:\\L", "Programs", "paperboard", "paperboard.exe"));
        expect(ps1).toContain("'Programs\\paperboard\\paperboard.exe'");
    });
});
