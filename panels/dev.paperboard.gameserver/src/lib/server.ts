import { createSignal } from "solid-js";
import { createPanelBridge, system, config, files as fileApi } from "@paperboard-dev/paperapi";
import type { PaperConsoleEntry, PaperBadgeVariant } from "@paperboard-dev/paperui";
import stripAnsi from "strip-ansi";
import { SOFTWARE_NAMES, type ServerSoftwareType } from "./software";
import {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    onlinePlayerNames,
    playerStats,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerStats,
    seenPlayerNames,
    setOnlinePlayerNames,
    setSeenPlayerNames,
    setPlayerStats,
    setPlayerPlaytime,
    type PlayerStatData,
} from "./players";
import { setActiveIssue, clearActiveIssue, type ServerIssue } from "./diagnostics";
import { parseProperties as coreParseProperties, extractServerPort, cleanMotdValue } from "../core/properties";
import { applyStatePatch } from "../core/state";
import type { ServerStatus as CoreServerStatus, ChatMessage as CoreChatMessage } from "../core/state";
import { PLAYER_NAME_PATTERN as CORE_PLAYER_NAME_PATTERN, SERVER_PROC_ID as CORE_SERVER_PROC_ID } from "../core/players";

export type ServerStatus = CoreServerStatus;
export interface ChatMessage extends CoreChatMessage {}

export const SERVER_PROC_ID = CORE_SERVER_PROC_ID;
export { stripAnsi };
export const PLAYER_NAME_PATTERN = CORE_PLAYER_NAME_PATTERN;

export const [serverStatus, setServerStatus] = createSignal<ServerStatus>("offline");
export const [serverEntries, setServerEntries] = createSignal<PaperConsoleEntry[]>([]);
export const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
export const [localIp, setLocalIp] = createSignal("127.0.0.1");
export const [serverPort, setServerPort] = createSignal("25565");
export const [serverMotd, setServerMotd] = createSignal("A Minecraft Server");
export const [serverSoftware, setServerSoftware] = createSignal<ServerSoftwareType>("paper");
export const [serverVersion, setServerVersion] = createSignal("");
export const [ramAllocation, setRamAllocation] = createSignal(4);

export const MIN_RAM_GB = 1;
export const MAX_RAM_GB = 16;

export function parseProperties(content: string): Record<string, string> {
    return coreParseProperties(content);
}

export function getLocalNetworkIP(): Promise<string> {
    return system.getLocalIP();
}

export const serverBridge = createPanelBridge({
    panelId: "dev.paperboard.gameserver",
});

function currentSetters() {
    return {
        setServerStatus,
        setServerEntries,
        setChatMessages,
        setLocalIp,
        setServerPort,
        setServerMotd,
        setServerSoftware,
        setServerVersion,
        setRamAllocation,
        setActiveIssue,
        setOnlinePlayerNames,
        setSeenPlayerNames,
        setPlayerStats,
        setPlayerPlaytime,
    };
}

serverBridge.onStateChange((patch) => {
    applyStatePatch(patch as Record<string, unknown>, currentSetters());
});

serverBridge.refreshState().then((state: any) => {
    applyStatePatch(state as Record<string, unknown>, currentSetters());
});

export async function loadServerConfig() {
    try {
        const saved = await config.get<any>();
        if (saved && typeof saved === "object") {
            if (saved.version) setServerVersion(saved.version);
            if (saved.software) setServerSoftware(saved.software);
            if (typeof saved.ramGB === "number") setRamAllocation(saved.ramGB);
        }
    } catch {}

    try {
        const propertiesContent = await fileApi.read("server.properties");
        if (propertiesContent) {
            const props = parseProperties(propertiesContent);
            const port = extractServerPort(props);
            if (port) setServerPort(port);
            const motd = cleanMotdValue(props["motd"]);
            if (motd) setServerMotd(motd);
        }
    } catch {}

    try {
        await serverBridge.actions.loadServerConfig();
    } catch {}
}

loadServerConfig();

export async function updatePanelConfig(patch: Record<string, unknown>) {
    let current: Record<string, unknown> = {};
    try {
        const saved = await config.get<Record<string, unknown>>();
        if (saved && typeof saved === "object") current = saved;
    } catch {}
    await config.set({ ...current, ...patch });
    await loadServerConfig();
    try {
        await serverBridge.actions.updatePanelConfig(patch);
    } catch {}
}

export async function initServerListeners() {
    await loadServerConfig();
    await serverBridge.refreshState();
}

export function startServer() {
    serverBridge.call("start-server").catch(() => {});
}

export function stopServer() {
    serverBridge.call("stop-server").catch(() => {});
}

export function restartServer() {
    serverBridge.call("restart-server").catch(() => {});
}

export function sendServerCommand(cmd: string) {
    serverBridge.call("run-command", { command: cmd }).catch(() => {});
}

export function sendChatMessage(msg: string) {
    serverBridge.call("say-chat", { message: msg }).catch(() => {});
}

export function getStatusBadge(status: ServerStatus): {
    label: string;
    variant: PaperBadgeVariant;
} {
    switch (status) {
        case "online":
            return { label: "Online", variant: "green" };
        case "starting":
            return { label: "Starting...", variant: "yellow" };
        case "stopping":
            return { label: "Stopping...", variant: "red" };
        case "restarting":
            return { label: "Restarting...", variant: "yellow" };
        case "offline":
        default:
            return { label: "Offline", variant: "monochrome" };
    }
}

export {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    onlinePlayerNames,
    playerStats,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerStats,
    seenPlayerNames,
};
export type { PlayerStatData };
