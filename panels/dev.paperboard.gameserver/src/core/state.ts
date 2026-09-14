import type { PaperConsoleEntry } from "@paperboard-dev/paperui";
import type { ServerSoftwareType } from "../lib/software";
import type { PlayerStatData, PlayerPosition } from "./players";
import type { ServerIssue } from "./diagnostics";

export type ServerStatus =
    | "offline"
    | "starting"
    | "online"
    | "stopping"
    | "restarting";

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: string;
    sender?: string;
    content?: string;
}

// Live jar-download progress published by installServerVersion through
// service state (bridge calls are request/response, so there is no other
// channel). Null when no install is running.
export interface InstallProgress {
    stage: "downloading" | "verifying" | "completed" | "error";
    percent: number;
}

export interface StateSetters {
    setServerStatus: (v: ServerStatus) => void;
    setServerEntries: (v: PaperConsoleEntry[]) => void;
    setChatMessages: (v: ChatMessage[]) => void;
    setLocalIp: (v: string) => void;
    setServerPort: (v: string) => void;
    setServerMotd: (v: string) => void;
    setServerSoftware: (v: ServerSoftwareType) => void;
    setServerVersion: (v: string) => void;
    setRamAllocation: (v: number) => void;
    setActiveIssue: (v: ServerIssue | null) => void;
    setOnlinePlayerNames: (v: Set<string>) => void;
    setSeenPlayerNames: (v: Set<string>) => void;
    setPlayerStats: (v: Map<string, PlayerStatData>) => void;
    setPlayerPositions: (v: Map<string, PlayerPosition>) => void;
    setPlayerPlaytime: (v: Map<string, number>) => void;
    setGamerules: (v: Record<string, string>) => void;
    setInstallProgress: (v: InstallProgress | null) => void;
}

// serverVersion applies only when truthy, rest when defined
export function applyStatePatch(
    source: Record<string, unknown> | null | undefined,
    setters: StateSetters,
): void {
    if (!source || typeof source !== "object") return;

    const table: { key: string; apply: (value: unknown) => void }[] = [
        { key: "serverStatus", apply: (v) => setters.setServerStatus(v as ServerStatus) },
        { key: "serverEntries", apply: (v) => setters.setServerEntries(v as PaperConsoleEntry[]) },
        { key: "chatMessages", apply: (v) => setters.setChatMessages(v as ChatMessage[]) },
        { key: "localIp", apply: (v) => setters.setLocalIp(v as string) },
        { key: "serverPort", apply: (v) => setters.setServerPort(v as string) },
        { key: "serverMotd", apply: (v) => setters.setServerMotd(v as string) },
        {
            key: "serverSoftware",
            apply: (v) => setters.setServerSoftware(v as ServerSoftwareType),
        },
        {
            key: "serverVersion",
            apply: (v) => {
                if (v) setters.setServerVersion(v as string);
            },
        },
        { key: "ramAllocation", apply: (v) => setters.setRamAllocation(v as number) },
        { key: "activeIssue", apply: (v) => setters.setActiveIssue(v as ServerIssue | null) },
        {
            key: "onlinePlayers",
            apply: (v) => setters.setOnlinePlayerNames(new Set<string>(v as string[])),
        },
        {
            key: "seenPlayers",
            apply: (v) => setters.setSeenPlayerNames(new Set<string>(v as string[])),
        },
        {
            key: "playerStats",
            apply: (v) =>
                setters.setPlayerStats(
                    new Map<string, PlayerStatData>(
                        Object.entries(v as Record<string, PlayerStatData>),
                    ),
                ),
        },
        {
            key: "playerPlaytime",
            apply: (v) =>
                setters.setPlayerPlaytime(
                    new Map<string, number>(Object.entries(v as Record<string, number>)),
                ),
        },
        {
            key: "playerPositions",
            apply: (v) =>
                setters.setPlayerPositions(
                    new Map<string, PlayerPosition>(
                        Object.entries(v as Record<string, PlayerPosition>),
                    ),
                ),
        },
        {
            key: "gamerules",
            apply: (v) => setters.setGamerules(v as Record<string, string>),
        },
        {
            key: "installProgress",
            apply: (v) => setters.setInstallProgress(v as InstallProgress | null),
        },
    ];

    for (const { key, apply } of table) {
        const value = (source as Record<string, unknown>)[key];
        if (value !== undefined) apply(value);
    }
}
