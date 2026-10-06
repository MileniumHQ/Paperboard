import { PANEL_ID, ACTION_IDS } from "../service/contract";
import { createSignal } from "solid-js";
import { createPanelBridge } from "@mileniumhq/paperapi";
import type { PaperConsoleEntry, PaperBadgeVariant } from "@mileniumhq/paperui";
import stripAnsi from "strip-ansi";
import { SOFTWARE_NAMES, type ServerSoftwareType } from "./software";
import type { InstallProgress } from "../core/state";
import {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    loadPlayerStats,
    onlinePlayerNames,
    playerStats,
    playerPositions,
    playerStatSummaries,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerStats,
    queryPlayerPositions,
    seenPlayerNames,
    setOnlinePlayerNames,
    setSeenPlayerNames,
    setPlayerStats,
    setPlayerPositions,
    setPlayerPlaytime,
    type PlayerStatData,
    type PlayerPosition,
    type PlayerStatSummary,
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
export const [installProgress, setInstallProgress] =
    createSignal<InstallProgress | null>(null);
// last lifecycle (start/stop/restart) failure, surfaced on the Overview
// tab — bridge-call rejections otherwise land in console.error only, and
// a button that does nothing is a silent failure with a click handler.
export const [serverActionError, setServerActionError] = createSignal("");

export const MIN_RAM_GB = 1;
export const MAX_RAM_GB = 16;

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
        setPlayerPositions,
        setPlayerPlaytime,
        setGamerules,
        setInstallProgress,
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
    await serverBridge.call(ACTION_IDS.updatePanelConfig, { patch });
    await serverBridge.refreshState();
}

export async function initServerListeners() {
    await loadServerConfig();
    await serverBridge.refreshState();
}

function reportActionError(action: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ServerBridge] ${action} failed:`, message);
    setServerActionError(message);
}

export function startServer() {
    setServerActionError("");
    serverBridge
        .call(ACTION_IDS.startServer)
        .catch((err) => reportActionError("start-server", err));
}

export function stopServer() {
    setServerActionError("");
    serverBridge
        .call(ACTION_IDS.stopServer)
        .catch((err) => reportActionError("stop-server", err));
}

export function restartServer() {
    setServerActionError("");
    serverBridge
        .call(ACTION_IDS.restartServer)
        .catch((err) => reportActionError("restart-server", err));
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
            return { label: "Online", variant: "success" };
        case "starting":
            return { label: "Starting...", variant: "warning" };
        case "stopping":
            return { label: "Stopping...", variant: "danger" };
        case "restarting":
            return { label: "Restarting...", variant: "warning" };
        case "offline":
        default:
            return { label: "Offline", variant: "monochrome" };
    }
}

export {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    loadPlayerStats,
    onlinePlayerNames,
    playerStats,
    playerPositions,
    playerStatSummaries,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerPositions,
    queryPlayerStats,
    seenPlayerNames,
};
export type { PlayerStatData, PlayerPosition, PlayerStatSummary };
