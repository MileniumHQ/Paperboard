import type { GameDefinition, GameOption } from "../types";
import { ACTION_IDS as A } from "../../service/contract";
import { gameArt } from "../art";

export const options: readonly GameOption[] = [
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 1, max: 255, default: 8, restartRequired: true },
    { id: "password", label: "Join password", kind: "secret", restartRequired: true },
    { id: "port", label: "Port", description: "The TCP port players join on.", kind: "number", min: 1, max: 65535, default: 7777, restartRequired: true },
    { id: "autocreate", label: "World size", kind: "select", choices: [{ value: "1", label: "Small" }, { value: "2", label: "Medium" }, { value: "3", label: "Large" }], default: "1", restartRequired: true, scope: "world" },
    { id: "difficulty", label: "Difficulty", kind: "select", choices: [{ value: "0", label: "Classic" }, { value: "1", label: "Expert" }, { value: "2", label: "Master" }, { value: "3", label: "Journey" }], default: "0", restartRequired: true, scope: "world" },
    { id: "seed", label: "Seed", description: "Leave empty for a random world.", kind: "text", default: "", restartRequired: true, scope: "world" },
    { id: "motd", label: "Message of the day", kind: "text", default: "", restartRequired: false, scope: "overview" },
    { id: "secure", label: "Additional cheat protection", kind: "boolean", default: true, restartRequired: true },
    { id: "language", label: "Console language", description: "English console output is required by this release’s readiness and save adapter.", kind: "select", choices: ["en-US"].map(value => ({ value, label: value })), default: "en-US", restartRequired: true },
];
/** The options a new world is generated with, asked for in New World rather than Options. */
export const WORLD_GENERATION: readonly string[] = options.filter(o => o.scope === "world").map(o => o.id);
export const terraria: GameDefinition = {
    id: "terraria", name: "Terraria", icon: "landscape", art: gameArt("terraria"),
    softwareLabel: ({ software, version }) => { if (software !== "vanilla") throw new Error(`Unsupported Terraria software: ${software}`); return `Vanilla ${version}`.trim(); },
    hostSupport({ os, arch }) {
        if (arch !== "x64") return { supported: false, reason: "Terraria requires an x64 host. Apple Silicon has no certification machine; Rosetta is not certified." };
        if (os !== "linux") return { supported: false, reason: "This Terraria host route is awaiting Windows x64 / Intel Mac certification. Linux x64 is the verified server route." };
        return { supported: true };
    },
    describe({ software }) {
        if (software !== "vanilla") throw new Error(`Unsupported Terraria software: ${software}`);
        return {
            options, control: { kind: "stdin" }, packages: [], widgets: ["status", "console"],
            actions: [A.startServer, A.stopServer, A.restartServer, A.runCommand, A.loadConfig, A.sayChat, A.listServerFiles, A.readServerFile, A.writeServerFile, A.listLogFiles, A.readLogFile, "read-game-options", "write-game-options", "terraria-versions", "terraria-install", "terraria-worlds", "terraria-world", "terraria-world-delete", "terraria-world-inspect", "terraria-world-import", "terraria-world-discard", "terraria-save", "terraria-motd", "backup-server"],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill" },
                { id: "worlds", label: "Worlds", icon: "public", group: "World", owner: "game" },
                { id: "versions", label: "Versions", icon: "deployed_code", group: "Software", owner: "game" },
                { id: "options", label: "Options", icon: "tune", group: "Server", owner: "shared" },
                { id: "files", label: "Files", icon: "folder", group: "Server", owner: "shared", variant: "fill" },
                { id: "logs", label: "Logs", icon: "description", group: "Server", owner: "shared", variant: "fill" },
                { id: "backups", label: "Backups", icon: "backup", group: "Server", owner: "shared" },
            ],
        };
    },
};
