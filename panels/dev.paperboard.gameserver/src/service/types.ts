import type { Infer } from "@mileniumhq/paperapi";
import type { ServerSoftwareType } from "../lib/software";
import type { ServerStatus as CoreServerStatus, ChatMessage as CoreChatMessage, InstallProgress, ModpackProgress } from "../core/state";
import {
    PLAYER_NAME_PATTERN as CORE_PLAYER_NAME_PATTERN,
    SERVER_PROC_ID as CORE_SERVER_PROC_ID,
} from "../core/players";
import type { PlayerStatData as CorePlayerStatData } from "../core/players";
import type { PlayerPosition as CorePlayerPosition } from "../core/players";
import type { ServerIssue as CoreServerIssue, ServerIssueAction as CoreServerIssueAction } from "../core/diagnostics";
import { WORLD_NAME_PATTERN as CORE_WORLD_NAME_PATTERN } from "../core/worlds";
import type { InstalledRecord as CoreInstalledRecord, InstalledPlugin as CoreInstalledPlugin } from "../core/plugins";
import { PANEL_ID, type serverStateShape } from "./contract";

export type ServerStatus = CoreServerStatus;
export type ChatMessage = CoreChatMessage;
export type PlayerStatData = CorePlayerStatData;
export type PlayerPosition = CorePlayerPosition;
export type ServerIssue = CoreServerIssue;
export type ServerIssueAction = CoreServerIssueAction;
export type InstalledRecord = CoreInstalledRecord;
export type InstalledPlugin = CoreInstalledPlugin;

// contract.ts owns the id now; types.ts re-exports for the renderer
export { PANEL_ID } from "./contract";

/** A server's own state, as the contract's keyed state carries it. */
export type GameServerState = Infer<typeof serverStateShape>;
/** A console line as the service keeps it: text only, as it travels as JSON. */
export type ConsoleLine = GameServerState["serverEntries"][number];

export const SERVER_PROC_ID = CORE_SERVER_PROC_ID;
export const MAX_BUFFERED_ENTRIES = 1000;
export const PLAYER_NAME_PATTERN = CORE_PLAYER_NAME_PATTERN;
export const WORLD_NAME_PATTERN = CORE_WORLD_NAME_PATTERN;

export function appendCapped<T>(prev: T[], entry: T): T[] {
    const next = [...prev, entry];
    return next.length > MAX_BUFFERED_ENTRIES
        ? next.slice(next.length - MAX_BUFFERED_ENTRIES)
        : next;
}
