import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseHomeLayout } from "../../../src/renderer/src/lib/homeLayout";
import { memberIdOf } from "daemon/network/roster";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, type BuiltApp, type BuiltCrane } from "./support/build";
import { CraneSocket, startCrane, WAIT_MS } from "./support/crane";
import { launchElectron, SHELL, shellReady } from "./support/electron";
import { tempDir } from "./support/temp";

// Every snapshot a shipped release wrote. A format change adds one here
// (scripts/snapshot-release-data.ts) and never regenerates an old one.
const SNAPSHOTS = ["release-data-0.3.0"];
const PANEL = "dev.paperboard.snapshot";

function files(root: string, dir = root): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? files(root, full) : [path.relative(root, full)];
    });
}

const readJson = (dir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"));

let app: BuiltApp;
let crane: BuiltCrane;
beforeAll(async () => {
    [app, crane] = await Promise.all([buildApp(), buildCrane()]);
}, BUILD_TIMEOUT_MS);

// The data a shipped release wrote still loads after an update.
describe("release data from a shipped release", () => {
    for (const name of SNAPSHOTS) {
        test(`${name} opens in the new daemon and app with every token, config and record intact`, async () => {
            const snapshot = path.join(import.meta.dir, "fixtures", name);
            const dataDir = path.join(tempDir("release-data"), "data");
            fs.cpSync(snapshot, dataDir, { recursive: true });
            fs.rmSync(path.join(dataDir, "README.md"));
            const written = files(dataDir).map((rel) => rel.split(path.sep).join("/"));
            const tokens: any[] = readJson(dataDir, "local/authorized_tokens.json");
            // the old daemon's own session ends with it; everything else is trust a person gave
            const kept = tokens.filter((t) => t.clientName !== "host");
            const before = new Map(written.map((rel) => [rel, fs.readFileSync(path.join(dataDir, ...rel.split("/")))]));

            const daemon = await startCrane(crane.file, dataDir);
            for (const entry of kept) {
                const socket = await CraneSocket.authed(daemon.handshake.port, entry.token);
                socket.close();
            }
            const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
            expect(await host.call("config:get", { id: PANEL })).toEqual({ data: readJson(snapshot, `configs/${PANEL}.json`) });
            expect(await host.call("config:get", { id: PANEL, path: "worlds/main.json" })).toEqual({ data: readJson(snapshot, `files/${PANEL}/worlds/main.json`) });
            const layout = await host.call("config:get", { id: "shell-home-layout" });
            expect(layout).toEqual({ data: readJson(snapshot, "local/shell-home-layout.json") });
            expect(parseHomeLayout(layout.data)).toHaveLength(layout.data.items.length);
            const { claims } = await host.call("ports:all");
            // a claim from before runs of ports holds the one port it named
            expect(claims).toEqual(readJson(snapshot, "ports.json").claims.map((claim: object) => ({ ...claim, count: 1 })));
            // the old format of backup is not recognised: it is not listed, and it is left as it was
            const record = written.find((rel) => rel.startsWith(`backups/panels/${PANEL}/`) && rel.endsWith(".json"))!;
            expect(await host.call("backup:list", { panelId: PANEL })).toEqual({ backups: [] });
            expect(await host.call("backup:status", { panelId: PANEL })).toMatchObject({ location: { id: "local", kind: "local" } });
            expect(written).toContain(record.replace(/\.json$/, ".pbbackup"));
            // 0.4's paired computers (the desktop app's own list) are in the roster, named by their keys
            const paired = readJson(snapshot, "local/paired_computers.json").computers[0];
            const roster = await host.call("computers:list");
            expect(roster.members.find((m: any) => m.id === memberIdOf(paired.cert))).toMatchObject({ name: paired.name, dial: { host: paired.host, port: paired.port }, cert: paired.cert });
            expect(roster.tokens[memberIdOf(paired.cert)]).toBe(paired.token);
            expect(roster.aliases[paired.id]).toBe(memberIdOf(paired.cert));
            host.close();
            await daemon.stop();

            // the new app on the same data: its paired computer and settings
            const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
            await shellReady(electron);
            // under the id 0.4 gave it: its panels' pages keep their origin
            const listed = await electron.evalIn(SHELL, `window.paperboardShell.invoke("computers-list")`);
            expect(listed.computers.find((c: any) => c.id === paired.id)).toMatchObject({ name: paired.name, host: paired.host, port: paired.port });
            expect(await electron.evalMain(`return electron.nativeTheme.themeSource`)).toBe("dark");
            expect(electron.failures()).toEqual([]);
            await electron.quit();

            // nothing quarantined, nothing gone but what was moved, nothing rewritten but bookkeeping
            const after = files(dataDir).map((rel) => rel.split(path.sep).join("/"));
            expect(after.filter((rel) => rel.includes(".corrupt-"))).toEqual([]);
            // TODO(remove after v0.6): with importPairedComputers
            const moved = new Set(["local/paired_computers.json"]);
            for (const rel of moved) expect(after).not.toContain(rel);
            for (const [rel, bytes] of before) {
                if (moved.has(rel)) continue;
                expect(after).toContain(rel);
                if (rel === "local/authorized_tokens.json") continue;
                expect({ rel, same: fs.readFileSync(path.join(dataDir, ...rel.split("/"))).equals(bytes) }).toEqual({ rel, same: true });
            }
            const tokensAfter: any[] = readJson(dataDir, "local/authorized_tokens.json");
            const strip = ({ lastSeenAt: _seen, ...rest }: any) => rest;
            for (const entry of kept) expect(tokensAfter.map(strip)).toContainEqual(strip(entry));
        }, WAIT_MS * 4);
    }
});
