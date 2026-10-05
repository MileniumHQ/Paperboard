// macOS ships a ZIP, not a DMG. The ZIP is both the installer users extract
// and the payload electron-updater consumes, and it can be produced on the
// Linux/Windows CI runners without macOS-only DMG tooling (hdiutil). This
// pins that decision against the electron-builder config so a DMG target
// cannot quietly return.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
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
