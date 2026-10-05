import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paperboardArtifacts } from "./publishLib";

// Read and validate through the same installed builder that produces releases.
const appDir = fileURLToPath(new URL("../apps/paperboard/", import.meta.url));
const appRequire = createRequire(`${appDir}/package.json`);
const builderRequire = createRequire(appRequire.resolve("electron-builder"));
const { getConfig, validateConfiguration } = builderRequire("app-builder-lib/out/util/config/config");

test("Mac packaging produces DMG installers and ZIP updates for both architectures", async () => {
    const config = await getConfig(appDir);
    await validateConfiguration(config);
    const pkg = appRequire("./package.json");
    for (const arch of ["x64", "arm64"] as const) {
        const outputs = config.mac.target
            .filter((target: { arch: string[] }) => target.arch.includes(arch))
            .map((target: { target: string }) => config.mac.artifactName
                .replace("${name}", pkg.name)
                .replace("${version}", pkg.version)
                .replace("${arch}", arch)
                .replace("${ext}", target.target));
        expect(outputs).toEqual(paperboardArtifacts(`macos-${arch}`, pkg.version).map((a) => a.buildFile));
    }
    expect(config.dmg.window).toMatchObject({ width: 540, height: 380 });
    expect(config.dmg.iconSize).toBe(80);
    const background = resolve(appDir, config.dmg.background);
    for (const [path, scale] of [[background, 1], [background.replace(/\.png$/, "@2x.png"), 2]] as const) {
        const png = readFileSync(path);
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(png.subarray(12, 16).toString()).toBe("IHDR");
        expect(png.readUInt32BE(16)).toBe(config.dmg.window.width * scale);
        expect(png.readUInt32BE(20)).toBe(config.dmg.window.height * scale);
    }
    expect(config.dmg.contents).toEqual([
        { x: 130, y: 220, type: "file" },
        { x: 410, y: 220, type: "link", path: "/Applications" },
    ]);
});
