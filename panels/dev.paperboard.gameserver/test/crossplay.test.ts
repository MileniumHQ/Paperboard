import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { tempDir, writeTree } from "./helpers/tmp";
import { findCrossplayJars, prepareCrossplay, readCrossplay, writeCrossplaySetting } from "../src/service/crossplay";
import type { LoaderSettingView } from "../src/service/loaderSettings";

const FIXTURE = path.join(import.meta.dir, "fixtures", "crossplay", "paper");
const GEYSER = "plugins/Geyser-Spigot/config.yml";
const FLOODGATE = "plugins/floodgate/config.yml";
const PROPERTIES = "#Minecraft server properties\n#Thu Oct 29 12:00:00 UTC 2026\nmotd=\\u00A7aHello\nenforce-secure-profile=true\nserver-port=25565\nmax-players=20\n";

/** a Paper server with the config Geyser and Floodgate wrote on first start */
function paperServer(): { root: string; deps: { serverDir: () => Promise<string> }; read: (rel: string) => string } {
    const root = tempDir("gameserver-crossplay-");
    fs.cpSync(FIXTURE, root, { recursive: true });
    writeTree(root, { "server.properties": PROPERTIES });
    return { root, deps: { serverDir: async () => root }, read: (rel) => fs.readFileSync(path.join(root, ...rel.split("/")), "utf8") };
}

/** a plugin jar naming itself `name` in its plugin.yml */
const pluginJar = (name: string) => zipSync({ "plugin.yml": strToU8(`name: ${name}\nversion: 1\nmain: x.Main\n`) });

const changedLines = (before: string, after: string) => {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]!]]));
};

function another(setting: LoaderSettingView): string {
    switch (setting.control) {
        case "toggle":
            return setting.value === "true" ? "false" : "true";
        case "select":
            return setting.options!.find((o) => o.value !== setting.value)!.value;
        case "number":
            return String(Number(setting.value) + 1);
        case "text":
            return "edited";
    }
}

// Crossplay lets Bedrock players in without damaging Geyser/Floodgate config.
describe("crossplay", () => {
    test("every setting reads the value Geyser and Floodgate generated, the default shown before the files exist", async () => {
        const { deps } = paperServer();
        const view = await readCrossplay("paper", deps);
        expect(view.groups.map((g) => [g.path, g.error ?? null, g.pending ?? false])).toEqual([
            [GEYSER, null, false],
            [FLOODGATE, null, false],
        ]);
        const empty = tempDir("gameserver-crossplay-empty-");
        const defaults = await readCrossplay("paper", { serverDir: async () => empty });
        const values = (v: typeof view) => v.groups.flatMap((g) => g.settings.map((s) => [s.id, s.value]));
        expect(values(view)).toEqual(values(defaults));
        expect(Object.fromEntries(values(view))).toMatchObject({ "geyser.port": "19132", "geyser.webrtc-port": "0", "floodgate.username-prefix": "." });
    });

    test("an edit changes exactly its own line, keeping comments and indentation", async () => {
        const { deps, read } = paperServer();
        const view = await readCrossplay("paper", deps);
        for (const group of view.groups) {
            for (const setting of group.settings) {
                const before = read(group.path);
                const value = another(setting);
                expect(await writeCrossplaySetting("paper", setting.id, value, deps)).toMatchObject({ id: setting.id, path: group.path });
                const changed = changedLines(before, read(group.path));
                expect([setting.id, changed.length]).toEqual([setting.id, 1]);
                const [[oldLine, newLine]] = changed as [[string, string]];
                expect(newLine.match(/^\s*/)![0]).toBe(oldLine.match(/^\s*/)![0]);
                const reread = (await readCrossplay("paper", deps)).groups.flatMap((g) => g.settings).find((s) => s.id === setting.id);
                expect([setting.id, reread?.value]).toEqual([setting.id, value]);
            }
        }
    });

    test("preparing sets floodgate auth, gives NetherNet its own port beside RakNet and allows unsigned chat, keeping every other byte", async () => {
        const { root, deps, read } = paperServer();
        // jars renamed by the user still count by the name inside them
        fs.writeFileSync(path.join(root, "plugins", "bedrock-bridge.jar"), pluginJar("Geyser-Spigot"));
        fs.writeFileSync(path.join(root, "plugins", "fg.jar"), pluginJar("floodgate"));
        fs.writeFileSync(path.join(root, "plugins", "Other.jar"), pluginJar("Essentials"));
        expect(await findCrossplayJars("paper", deps)).toEqual({ geyser: "bedrock-bridge.jar", floodgate: "fg.jar" });

        const geyser = read(GEYSER);
        const floodgate = read(FLOODGATE);
        const view = await prepareCrossplay("paper", deps);
        expect([view.geyser, view.floodgate]).toEqual(["bedrock-bridge.jar", "fg.jar"]);
        expect(changedLines(geyser, read(GEYSER))).toEqual([
            ["  webrtc-port: 0", "  webrtc-port: 19133"],
            ["  transport: nethernet", "  transport: both"],
            ["  auth-type: online", "  auth-type: floodgate"],
        ]);
        expect(read(FLOODGATE)).toBe(floodgate);
        expect(read("server.properties")).toBe(PROPERTIES.replace("enforce-secure-profile=true", "enforce-secure-profile=false"));

        // preparing again changes nothing
        const settled = read(GEYSER);
        await prepareCrossplay("paper", deps);
        expect(read(GEYSER)).toBe(settled);
        expect(read("server.properties")).toBe(PROPERTIES.replace("enforce-secure-profile=true", "enforce-secure-profile=false"));
    });

    test("a transport the user chose is kept, and a server.properties not written yet gets only the chat line", async () => {
        const raknet = paperServer();
        // transport is not on the tab; someone who wants RakNet only edits the file
        const file = path.join(raknet.root, ...GEYSER.split("/"));
        fs.writeFileSync(file, raknet.read(GEYSER).replace("  transport: nethernet\n", "  transport: raknet\n"));
        await prepareCrossplay("paper", raknet.deps);
        expect(raknet.read(GEYSER)).toContain("  transport: raknet\n");
        expect(raknet.read(GEYSER)).toContain("  webrtc-port: 0\n");

        const picked = paperServer();
        await writeCrossplaySetting("paper", "geyser.webrtc-port", "20000", picked.deps);
        await prepareCrossplay("paper", picked.deps);
        // NetherNet on a port someone picked was set on purpose
        expect(picked.read(GEYSER)).toContain("  transport: nethernet\n");
        expect(picked.read(GEYSER)).toContain("  webrtc-port: 20000\n");

        fs.rmSync(path.join(picked.root, "server.properties"));
        await prepareCrossplay("paper", picked.deps);
        expect(picked.read("server.properties")).toBe("enforce-secure-profile=false\n");
    });

    test("a Bedrock port on the Java port or on the other Bedrock port is refused, and so are unknown settings and software", async () => {
        const { deps, read, root } = paperServer();
        await prepareCrossplay("paper", deps);
        const before = read(GEYSER);
        await expect(writeCrossplaySetting("paper", "geyser.port", "25565", deps)).rejects.toThrow("Port 25565 is the Java server's port");
        await expect(writeCrossplaySetting("paper", "geyser.port", "19133", deps)).rejects.toThrow("Port 19133 is already Geyser's other Bedrock port");
        await expect(writeCrossplaySetting("paper", "geyser.webrtc-port", "19132", deps)).rejects.toThrow("Port 19132 is already Geyser's other Bedrock port");
        await expect(writeCrossplaySetting("paper", "geyser.port", "19132\n  transport: raknet", deps)).rejects.toThrow();
        await expect(writeCrossplaySetting("paper", "java.auth-type", "offline", deps)).rejects.toThrow("Unknown crossplay setting");
        expect(read(GEYSER)).toBe(before);
        for (const software of ["vanilla", "forge"] as const) {
            await expect(readCrossplay(software, { serverDir: async () => root })).rejects.toThrow("Crossplay needs Paper, Fabric or NeoForge");
        }
    });
});
