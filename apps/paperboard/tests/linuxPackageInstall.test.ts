import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { linuxPackageInstall } from "../src/main/linuxPackageInstall";

describe("Linux package installs", () => {
    const dirs: string[] = [];
    afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
    // a resources directory as electron-builder lays one out
    function resources(packageType?: string): string {
        const dir = mkdtempSync(join(tmpdir(), "pb-resources-"));
        dirs.push(dir);
        if (packageType !== undefined) writeFileSync(join(dir, "package-type"), packageType);
        return dir;
    }

    it("offers a deb or rpm from Paperboard as the same package for the same arch", () => {
        expect(linuxPackageInstall(resources("deb"), "x64")).toEqual({
            feedUrl: "https://i.paperboard.dev/pb/latest-linux.yml",
            download: "https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb",
        });
        expect(linuxPackageInstall(resources("rpm\n"), "arm64")).toEqual({
            feedUrl: "https://i.paperboard.dev/pb/latest-linux-arm64.yml",
            download: "https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.rpm",
        });
    });

    it("leaves installs Paperboard ships no file for to their package manager", () => {
        expect(linuxPackageInstall(resources("pacman"), "x64").download).toBeNull();
        expect(linuxPackageInstall(resources(), "arm64")).toEqual({
            feedUrl: "https://i.paperboard.dev/pb/latest-linux-arm64.yml",
            download: null,
        });
    });

    it("refuses an arch Paperboard is not built for", () => {
        expect(() => linuxPackageInstall(resources("deb"), "ia32")).toThrow("Paperboard is not built for Linux ia32");
    });
});
