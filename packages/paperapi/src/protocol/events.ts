// The events the daemon pushes: a socket's own streams (a terminal's output,
// a download's progress) and the broadcasts it declared with events:subscribe.
// Events named at run time (a Blocks event, "blocks:<panel>:<entry>") carry
// what the panel that fires them says, and are not declared here.
import type { BackupProgress } from "../backups";
import type { BACKUP_PROGRESS_EVENT } from "../channels";
import type { PROBLEMS_EVENT, PanelProblem } from "../problemShape";

export type ProgressStage = "starting" | "checking" | "stopping" | "downloading" | "verifying" | "extracting" | "completed" | "error";

export interface StreamExitedEvent {
    id: string;
    exitCode?: number | null;
}

export interface RegistryChangeEvent {
    type: string;
    panelId?: string;
    entry?: string;
    /** what one registration pass added, on "blocks:registered" */
    entries?: string[];
    project?: unknown;
}

export interface RpcEventPayloads {
    "term:data": { id: string; data: string };
    "term:exit": StreamExitedEvent;
    "term:foreground": { id: string; name: string };
    "term:command": { id: string; command: string; exitCode: number };
    "term:cwd": { id: string; cwd: string };
    "process:data": { id: string; data: string; stream: string };
    "process:exit": StreamExitedEvent;
    progress: {
        downloadId: string;
        stage: ProgressStage;
        percent: number;
        bytesLoaded?: number;
        bytesTotal?: number;
        message?: string;
        target?: string;
    };
    [BACKUP_PROGRESS_EVENT]: {
        panelId: string;
        target: string | null;
        progress: BackupProgress | null;
    };
    [PROBLEMS_EVENT]: {
        panelId: string;
        problems: PanelProblem[];
    };
    "blocks:registry-updated": RegistryChangeEvent;
    /** the roster changed: this computer's app asks computers:list again */
    "computers:changed": Record<string, never>;
}

export type RpcEvent = keyof RpcEventPayloads;
/** What an event's listeners hear: its typed payload, or what the panel that fired it said. */
export type EventPayload<E extends string> = E extends RpcEvent ? RpcEventPayloads[E] : unknown;
/** How far a download, an install or an update is. */
export type ProgressEvent = EventPayload<"progress">;
