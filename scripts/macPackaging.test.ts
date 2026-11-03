// macOS ships a ZIP, not a DMG. The ZIP is both the installer users extract
// and the payload electron-updater consumes, and it can be produced on the
// Linux/Windows CI runners without macOS-only DMG tooling (hdiutil). This
// pins that decision against the electron-builder config so a DMG target
// cannot quietly return.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appDir = join(import.meta.dir, "..", "apps", "paperboard");
const config = Bun.YAML.parse(
    readFileSync(join(appDir, "electron-builder.yml"), "utf8"),
) as {
    mac: { target: unknown; notarize?: boolean };
    dmg?: unknown;
};

describe("macOS packaging", () => {
    it("targets only a ZIP for both architectures", () => {
        expect(config.mac.target).toEqual([
            { target: "zip", arch: ["x64", "arm64"] },
        ]);
    });

    it("declares no DMG target or DMG options", () => {
        expect(config.dmg).toBeUndefined();
    });
});

// electron-builder zips the macOS app with 7-Zip whenever it isn't built on a
// Mac, and 7-Zip copies what a symlink points to. A .framework is mostly
// symlinks, so that zip held Electron Framework three times over (~390 MB
// instead of ~140 MB). patches/app-builder-lib adds -snl to keep them links.
const appRequire = createRequire(require.resolve("electron-builder", { paths: [appDir] }));
const { archive } = appRequire("app-builder-lib/out/targets/archive") as {
    archive(format: string, outFile: string, dir: string, options: { preserveSymlinks?: boolean; withoutDir?: boolean }): Promise<string>;
};

/** each entry's Unix file type, from the zip's central directory */
function zipEntryTypes(zip: Buffer): Map<string, number> {
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(end + 10);
    let at = zip.readUInt32LE(end + 16);
    const types = new Map<string, number>();
    for (let i = 0; i < count; i++) {
        const nameLength = zip.readUInt16LE(at + 28);
        const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
        types.set(name, (zip.readUInt32LE(at + 38) >>> 16) & 0o170000);
        at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    return types;
}

describe.skipIf(process.platform === "win32")("macOS zip", () => {
    it("keeps a framework's symlinks as links", async () => {
        const root = mkdtempSync(join(tmpdir(), "pb-maczip-"));
        try {
            const app = join(root, "Paperboard.app");
            const framework = join(app, "Contents", "Frameworks", "Electron Framework.framework");
            mkdirSync(join(framework, "Versions", "A"), { recursive: true });
            writeFileSync(join(framework, "Versions", "A", "Electron Framework"), "binary");
            symlinkSync("A", join(framework, "Versions", "Current"));
            symlinkSync("Versions/Current/Electron Framework", join(framework, "Electron Framework"));
            const zip = join(root, "Paperboard.zip");
            await archive("zip", zip, app, { preserveSymlinks: true });
            const types = zipEntryTypes(readFileSync(zip));
            const inFramework = "Paperboard.app/Contents/Frameworks/Electron Framework.framework/";
            expect(types.get(`${inFramework}Versions/Current`)).toBe(0o120000);
            expect(types.get(`${inFramework}Electron Framework`)).toBe(0o120000);
            expect(types.get(`${inFramework}Versions/A/Electron Framework`)).toBe(0o100000);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 120_000);
});
