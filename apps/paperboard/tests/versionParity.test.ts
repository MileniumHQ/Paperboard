// version parity (bun test): the app, the crane it manages, the shared
// libraries, and every first-party panel manifest report one version. If any
// of these drift, the updater can manage a crane the app disagrees with.
import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { PAPERCRANE_VERSION } from "../papercrane/discovery";

const ROOT = path.join(import.meta.dir, "..", "..", "..");

function readJson(rel: string): any {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("version parity", () => {
    it("pins every version source to one equality", () => {
        const appVersion = readJson("apps/paperboard/package.json").version;
        const seen: Record<string, string> = {
            "apps/paperboard/package.json": appVersion,
            "packages/paperapi/package.json": readJson("packages/paperapi/package.json").version,
            "packages/paperui/package.json": readJson("packages/paperui/package.json").version,
            "papercrane/discovery PAPERCRANE_VERSION": PAPERCRANE_VERSION,
        };
        for (const panel of [
            "dev.paperboard.actions",
            "dev.paperboard.botcreator",
            "dev.paperboard.gameserver",
            "dev.paperboard.terminal",
        ]) {
            seen[`panels/${panel}/manifest.json`] = readJson(`panels/${panel}/manifest.json`).version;
        }
        for (const [source, version] of Object.entries(seen)) {
            expect(`${source}=${version}`, `drift in ${source}`).toBe(
                `${source}=${appVersion}`,
            );
        }
    });
});
