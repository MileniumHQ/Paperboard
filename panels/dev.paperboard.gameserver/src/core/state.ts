import { batch, createSignal, onCleanup, type Accessor } from "solid-js";
import type { PaperConsoleEntry } from "@mileniumhq/paperui";
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

export interface StateSetters {
    setServerStatus: (v: ServerStatus) => void;
    setServerEntries: (v: PaperConsoleEntry[]) => void;
    setChatMessages: (v: ChatMessage[]) => void;
    setLocalIp: (v: string) => void;
    setServerPort: (v: string) => void;
    setServerMotd: (v: string) => void;
    setServerLevel: (v: string | null) => void;
    setServerSoftware: (v: string) => void;
    setGameSettings?: (v: Readonly<Record<string, unknown>>) => void;
    setServerVersion: (v: string) => void;
    setRamAllocation: (v: number) => void;
    setMaxPlayers?: (v: number | null) => void;
    setOnlineSince?: (v: number | null) => void;
    setActiveIssue: (v: ServerIssue | null) => void;
    setRecoveryBlock: (v: string | null) => void;
    setInitFailure: (v: string | null) => void;
    setOnlinePlayerNames: (v: Set<string>) => void;
    setSeenPlayerNames: (v: Set<string>) => void;
    setPlayerStats: (v: Map<string, PlayerStatData>) => void;
    setPlayerPositions: (v: Map<string, PlayerPosition>) => void;
    setPlayerPlaytime: (v: Map<string, number>) => void;
    setGamerules: (v: Record<string, string>) => void;
    setInstallProgress: (v: InstallProgress | null) => void;
    setModpackProgress: (v: ModpackProgress | null) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** an array whose items each carry an id, matched by it rather than by position */
function idOf(item: unknown): string | number | undefined {
    if (!isPlainObject(item)) return undefined;
    const id = item.id;
    return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/**
 * `next`, sharing every part of `prev` it equals: `prev` itself when nothing
 * changed, and otherwise a value whose unchanged items, entries and fields
 * are the very objects `prev` held. Every push from the service is a fresh
 * copy of the whole state; this is what lets a list keep its rows, and a
 * signal stay quiet, when the copy says nothing new. Arrays of items with an
 * id match them by id, other arrays by position; Sets and Maps by key; plain
 * objects by field. Anything else is equal only when identical.
 */
export function keepUnchanged<T>(prev: T, next: T): T {
    if (Object.is(prev, next)) return prev;
    if (Array.isArray(prev) && Array.isArray(next)) {
        const byId = new Map<string | number, unknown>();
        for (const item of prev) {
            const id = idOf(item);
            if (id !== undefined) byId.set(id, item);
        }
        let same = prev.length === next.length;
        const kept = next.map((item, index) => {
            const id = idOf(item);
            const old = id !== undefined && byId.has(id) ? byId.get(id) : index < prev.length ? prev[index] : undefined;
            const value = old === undefined ? item : keepUnchanged(old, item);
            if (value !== prev[index]) same = false;
            return value;
        });
        return (same ? prev : kept) as T;
    }
    if (prev instanceof Set && next instanceof Set) {
        if (prev.size !== next.size) return next;
        for (const item of next) if (!prev.has(item)) return next;
        return prev;
    }
    if (prev instanceof Map && next instanceof Map) {
        let same = prev.size === next.size;
        const kept = new Map();
        for (const [key, value] of next) {
            const old = prev.get(key);
            const item = prev.has(key) ? keepUnchanged(old, value) : value;
            if (!prev.has(key) || item !== old) same = false;
            kept.set(key, item);
        }
        return (same ? prev : kept) as T;
    }
    if (isPlainObject(prev) && isPlainObject(next)) {
        const keys = Object.keys(next);
        let same = keys.length === Object.keys(prev).length;
        const kept: Record<string, unknown> = {};
        for (const key of keys) {
            const has = Object.prototype.hasOwnProperty.call(prev, key);
            const value = has ? keepUnchanged(prev[key], next[key]) : next[key];
            if (!has || value !== prev[key]) same = false;
            kept[key] = value;
        }
        return (same ? prev : kept) as T;
    }
    return next;
}

/** whether two values hold the same data, by the rules of keepUnchanged */
export function sameData(a: unknown, b: unknown): boolean {
    return keepUnchanged(a, b) === a;
}

/**
 * A signal for state the service pushes: a value equal to the one it holds
 * (see keepUnchanged) notifies no one, and a changed one keeps the parts
 * that did not change.
 */
export function createStateSignal<T>(initial: T): [Accessor<T>, (next: T | ((prev: T) => T)) => void] {
    const [value, setValue] = createSignal<T>(initial);
    const set = (next: T | ((prev: T) => T)) => {
        const prev = value();
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        const kept = keepUnchanged(prev, resolved);
        if (kept !== prev) setValue(() => kept);
    };
    return [value, set];
}

// serverVersion applies only when truthy, rest when defined. One push is one
// update: everything it changes is seen together, once.
export function applyStatePatch(
    source: Record<string, unknown> | null | undefined,
    setters: StateSetters,
): void {
    if (!source || typeof source !== "object") return;
    batch(() => applyEach(source, setters));
}

function applyEach(source: Record<string, unknown>, setters: StateSetters): void {

    const table: { key: string; apply: (value: unknown) => void }[] = [
        { key: "gameSettings", apply: (v) => setters.setGameSettings?.(v as Record<string, unknown>) },
        { key: "serverStatus", apply: (v) => setters.setServerStatus(v as ServerStatus) },
        { key: "serverEntries", apply: (v) => setters.setServerEntries(v as PaperConsoleEntry[]) },
        { key: "chatMessages", apply: (v) => setters.setChatMessages(v as ChatMessage[]) },
        { key: "localIp", apply: (v) => setters.setLocalIp(v as string) },
        { key: "serverPort", apply: (v) => setters.setServerPort(v as string) },
        { key: "serverMotd", apply: (v) => setters.setServerMotd(v as string) },
        { key: "serverLevel", apply: (v) => setters.setServerLevel((v as string | null) ?? null) },
        { key: "maxPlayers", apply: (v) => setters.setMaxPlayers?.((v as number | null) ?? null) },
        { key: "onlineSince", apply: (v) => setters.setOnlineSince?.((v as number | null) ?? null) },
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
        { key: "recoveryBlock", apply: (v) => setters.setRecoveryBlock((v as string | null) ?? null) },
        { key: "initFailure", apply: (v) => setters.setInitFailure((v as string | null) ?? null) },
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
        {
            key: "modpackProgress",
            apply: (v) => setters.setModpackProgress(v as ModpackProgress | null),
        },
    ];

    for (const { key, apply } of table) {
        const value = (source as Record<string, unknown>)[key];
        if (value !== undefined) apply(value);
    }
}

/**
 * Late answers lose. Each read made through the returned function replaces
 * the ones made before it, and the owner going away replaces them all: a
 * replaced read resolves to `undefined`, whether it answered or failed. The
 * newest resolves to `{ value }`, or rejects with its own failure.
 */
export function createLatest(): <T>(read: () => Promise<T>) => Promise<{ value: T } | undefined> {
    let newest = 0;
    onCleanup(() => { newest++; });
    return async (read) => {
        const mine = ++newest;
        try {
            const value = await read();
            return mine === newest ? { value } : undefined;
        } catch (err) {
            if (mine !== newest) return undefined;
            throw err;
        }
    };
}
