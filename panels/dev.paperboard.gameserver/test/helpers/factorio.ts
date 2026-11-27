// What a Factorio server folder holds once its release is installed: the
// release record and the server, here the stand-in fakeFactorio.main.ts, at
// the path the publisher's archive puts it.
import * as fs from "node:fs";
import * as path from "node:path";
import { placeStandIn } from "./standIn";
import { newestRelease } from "../../src/games/factorio/catalog";

/** installs Factorio into the server folder `dir`; `plan` is the stand-in's fake-factorio.json */
export function installFactorio(dir: string, plan?: Record<string, unknown>): void {
    const install = path.join(dir, "install");
    fs.mkdirSync(path.join(install, "factorio", "data"), { recursive: true });
    fs.writeFileSync(path.join(install, "release.json"), JSON.stringify({ version: newestRelease.version, sha256: newestRelease.sha256, source: newestRelease.url }));
    placeStandIn("fakeFactorio", path.join(install, "factorio", "bin", "x64", "factorio"));
    if (plan) {
        fs.mkdirSync(path.join(dir, "data"), { recursive: true });
        fs.writeFileSync(path.join(dir, "data", "fake-factorio.json"), JSON.stringify(plan));
    }
}

/** the stand-in prints these as its own lines, in order */
export function serverSays(dir: string, ...lines: string[]): void {
    fs.appendFileSync(path.join(dir, "data", "fake-factorio-lines.txt"), lines.map((line) => `${line}\n`).join(""));
}

/** who the stand-in says is online */
export function playersOnline(dir: string, ...names: string[]): void {
    fs.writeFileSync(path.join(dir, "data", "fake-factorio-online.txt"), names.map((name) => `${name}\n`).join(""));
}
