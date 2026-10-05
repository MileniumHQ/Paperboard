import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareAur } from "./aur";

test("local AUR preparation pins both architectures and packages daemon into pacman-owned paths", () => {
    const root = mkdtempSync(join(tmpdir(), "paperboard-aur-"));
    try {
        const assets = join(root, "assets");
        mkdirSync(assets);
        for (const arch of ["x64", "arm64"]) {
            writeFileSync(join(assets, `paperboard-linux-${arch}.AppImage`), "app fixture");
            writeFileSync(join(assets, `crane-linux-${arch}.tar.gz`), "archive fixture");
        }
        const output = join(root, "aur");
        prepareAur({ version: "0.1.0-alpha.1", assets, output });
        for (const name of ["paperboard-bin", "papercrane-bin"]) {
            const directory = join(output, name);
            const info = readFileSync(join(directory, ".SRCINFO"), "utf8");
            expect(info).toContain("pkgver = 0.1.0_alpha.1");
            expect(info).toContain("arch = aarch64");
            expect(info).toContain("arch = x86_64");
            expect(info).toContain("provides = " + (name === "paperboard-bin" ? "paperboard" : "papercrane") + "=0.1.0_alpha.1");
            expect(info).toMatch(/sha256sums_x86_64 = [a-f0-9]{64}/);
            expect(info).toMatch(/sha256sums_aarch64 = [a-f0-9]{64}/);
            expect(info).toContain("/releases/download/" + (name === "paperboard-bin" ? "pb" : "crane") + "-v0.1.0-alpha.1/");
            expect(info).toContain(`source_x86_64 = 0.1.0-alpha.1-${name === "paperboard-bin" ? "paperboard-linux-x64.AppImage" : "crane-linux-x64.tar.gz"}::`);
            expect(info).not.toContain("SKIP");
            expect(info).not.toContain("/latest/");
        }
        const directory = join(output, "papercrane-bin");
        for (const [arch, binary] of [["x86_64", "papercrane-linux-x64"], ["aarch64", "papercrane-linux-arm64"]]) {
            writeFileSync(join(directory, binary), "daemon fixture");
            const pkgdir = join(root, arch);
            const result = spawnSync("bash", ["-c", 'source ./PKGBUILD; srcdir="$PWD"; pkgdir="$1"; CARCH="$2"; package', "package-test", pkgdir, arch], { cwd: directory, encoding: "utf8" });
            expect(result.status).toBe(0);
            expect(readFileSync(join(pkgdir, "usr/lib/papercrane/papercrane"), "utf8")).toBe("daemon fixture");
            expect(readFileSync(join(pkgdir, "usr/lib/systemd/user/papercrane.service"), "utf8")).toContain("KillMode=control-group");
            expect(existsSync(join(pkgdir, "usr/share/licenses/papercrane-bin/LICENSE"))).toBe(true);
        }
        expect(() => prepareAur({ version: "0.1.0", assets, output })).toThrow("already exists");
        expect(() => prepareAur({ version: "0.1.0", assets: join(root, "missing"), output: join(root, "missing-output") })).toThrow();
        expect(existsSync(join(root, "missing-output"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
