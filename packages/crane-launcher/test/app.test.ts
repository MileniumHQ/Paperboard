// The launcher opens Paperboard where the install scripts put it, and
// installs only with consent when the command reads as "open it".
import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";
import { askToInstall, installedAppCandidates } from "../src/app";

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

describe("plain npx asks before installing", () => {
    const answer = async (typed: string) => {
        const input = new PassThrough();
        const output = new PassThrough();
        output.resume();
        const asked = askToInstall(input, output);
        input.end(`${typed}\n`);
        return asked;
    };

    test("Enter or yes installs; anything else doesn't", async () => {
        expect(await answer("")).toBe(true);
        expect(await answer("y")).toBe(true);
        expect(await answer("YES")).toBe(true);
        expect(await answer("n")).toBe(false);
        expect(await answer("no")).toBe(false);
        expect(await answer("maybe")).toBe(false);
    });
});
