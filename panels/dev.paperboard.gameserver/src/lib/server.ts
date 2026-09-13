import { PANEL_ID, ACTION_IDS } from "../service/contract";
import { createSignal } from "solid-js";
import { createPanelBridge, system } from "@paperboard-dev/paperapi";
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
import { setActiveIssue, type ServerIssue } from "./diagnostics";
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
export const [gamerules, setGamerules] = createSignal<Record<string, string>>({});

export const MIN_RAM_GB = 1;
export const MAX_RAM_GB = 16;

export function getLocalNetworkIP(): Promise<string> {
    return system.getLocalIP();
}

export const serverBridge = createPanelBridge({
    panelId: PANEL_ID,
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
        setGamerules,
    };
}

serverBridge.onStateChange((patch) => {
    applyStatePatch(patch as Record<string, unknown>, currentSetters());
});

serverBridge.refreshState().then((state: any) => {
    applyStatePatch(state as Record<string, unknown>, currentSetters());
});

// config lives in the service (service/config.ts owns read-merge-write
// with an explicit PANEL_ID). The UI only triggers a reload and pulls the
// resulting state — the duplicated read-merge-write twins that lived here
// are gone, and with them the ambient (id-less) config.get/set calls.
export async function loadServerConfig() {
    try {
        await serverBridge.call(ACTION_IDS.loadConfig);
        await serverBridge.refreshState();
    } catch (err) {
        console.debug("[gameserver] service-side loadServerConfig failed:", String(err));
    }
}

loadServerConfig();

export async function updatePanelConfig(patch: Record<string, unknown>) {
    try {
        await serverBridge.call(ACTION_IDS.updatePanelConfig, { patch });
        await serverBridge.refreshState();
    } catch (err) {
        console.debug("[gameserver] service-side updatePanelConfig failed:", String(err));
    }
}

export async function initServerListeners() {
    await loadServerConfig();
    await serverBridge.refreshState();
}

export function startServer() {
    serverBridge
        .call(ACTION_IDS.startServer)
        .catch((err) =>
            console.error("[ServerBridge] start-server failed:", String(err)),
        );
}

export function stopServer() {
    serverBridge
        .call(ACTION_IDS.stopServer)
        .catch((err) =>
            console.error("[ServerBridge] stop-server failed:", String(err)),
        );
}

export function restartServer() {
    serverBridge
        .call(ACTION_IDS.restartServer)
        .catch((err) =>
            console.error("[ServerBridge] restart-server failed:", String(err)),
        );
}

export function sendServerCommand(cmd: string) {
    serverBridge.call(ACTION_IDS.runCommand, { command: cmd }).catch((err) =>
        console.error("[ServerBridge] run-command failed:", String(err)),
    );
}

export function sendChatMessage(msg: string) {
    serverBridge.call(ACTION_IDS.sayChat, { message: msg }).catch((err) =>
        console.error("[ServerBridge] say-chat failed:", String(err)),
    );
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
