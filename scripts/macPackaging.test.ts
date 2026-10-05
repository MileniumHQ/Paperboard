import { expect, test } from "bun:test";
import { createRequire } from "node:module";
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
    expect(config.dmg.contents).toEqual([
        { x: 130, y: 220, type: "file" },
        { x: 410, y: 220, type: "link", path: "/Applications" },
    ]);
});
