import { createMemo, type Accessor } from "solid-js";
import { serverStateShape } from "../service/contract";
import type { GameServerState } from "../service/types";


export type ServerStatus =
    | "offline"
    | "starting"
    | "online"
    | "stopping"
    | "restarting";

export interface ChatMessage {
    id: string;
    /** the line as the game printed it */
    text: string;
    timestamp: string;
    /** the player a message, join or leave is about */
    sender?: string;
    /** what was said, without the sender */
    content?: string;
    /** set for a join, a leave or a message from the server console; unset for player chat */
    event?: "join" | "leave" | "server";
}

// Live install progress published by installServerVersion through service
// state (bridge calls are request/response, so there is no other channel).
// "installing" is a software installer running (Forge, NeoForge), which
// reports no percentage. Null when no install is running.
export interface InstallProgress {
    // "preparing" is work with no measure yet: a downloader starting, or
    // making room for the files before it downloads them
    stage: "preparing" | "downloading" | "verifying" | "installing" | "completed" | "error";
    percent: number;
    // how much of how much, when the download says
    bytes?: { done: number; total: number };
}

// Live progress of a modpack install, published the same way. "done" and
// "total" count files while downloading; a loader switch inside the
// install reports through installProgress.
export interface ModpackProgress {
    stage: "preparing" | "downloading" | "installing-server" | "placing" | "completed" | "error";
    done: number;
    total: number;
}

export type Fields = { readonly [K in keyof GameServerState]: Accessor<GameServerState[K]> };

/** What the page shows of a server's state: a memo per field, and the players' as sets and maps by name. */
export function serverFields(state: Accessor<GameServerState | null>) {
    const fields = Object.fromEntries(
        Object.keys(serverStateShape.fields).map((key) => [key, createMemo(() => state()?.[key as keyof GameServerState])]),
    ) as unknown as Fields;
    return {
        ...fields,
        // a push mid-install can say no version yet; the page keeps the last one it knew
        serverVersion: createMemo<string>((prev) => state()?.serverVersion || prev, ""),
        onlinePlayerNames: createMemo(() => new Set(fields.onlinePlayers())),
        seenPlayerNames: createMemo(() => new Set(fields.seenPlayers())),
        playerStats: createMemo(() => new Map(Object.entries(fields.playerStats() ?? {}))),
        playerPlaytime: createMemo(() => new Map(Object.entries(fields.playerPlaytime() ?? {}))),
        playerPositions: createMemo(() => new Map(Object.entries(fields.playerPositions() ?? {}))),
    };
}
