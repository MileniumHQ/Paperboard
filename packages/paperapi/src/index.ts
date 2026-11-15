import { invoke, send, on, type StreamSubscription } from "./ipc";
import "./readiness";
import "./swipeBack";
import "./haptics";
import "./pageCrumbs";
import "./mobileMode";
import "./unsavedChanges";

export * from "./ipc";
export * from "./errors";
export * from "./records";
export * from "./serialQueue";
export * from "./config";
export * from "./registryFetch";
export * from "./panelMerge";
export * from "./storeListing";
export { isPanelId, requirePanelId } from "./panelIdentity";
export * from "./identity";
export { panelPath, parsePanelPath, PANEL_PATH_ROOT } from "./panelPath";
export { craneEndpoint, type CraneCredentials } from "./ws";
export * from "./secrets";
export * from "./backups";
export * from "./problems";
export * from "./ports";
export * from "./loopback";
export { SWIPE_BACK_MESSAGE, swipeBackMessage, type SwipeBackMessage } from "./swipeBack";
export { HAPTIC_MESSAGE, hapticMessage, type HapticMessage } from "./haptics";
export { PAGE_BACK_MESSAGE, PAGE_BARS_MESSAGE, PAGE_CRUMBS_MESSAGE, pageCrumbsMessage, type PageCrumbsMessage } from "./pageCrumbs";
export { MOBILE_MODE_MESSAGE } from "./mobileMode";
export { LEAVE_ANSWER_MESSAGE, LEAVE_REQUEST_MESSAGE, setUnsavedChanges, UNSAVED_CHANGES_MESSAGE, type LeaveAnswerMessage, type UnsavedChangesMessage } from "./unsavedChanges";
export { FRAME_BACKGROUND_MESSAGE, frameBackgroundMessage, isFrameBackgroundColor, type FrameBackgroundMessage } from "./frameBackground";
export * from "./package";
export * from "./file";
export * from "./process";
export * from "./panels";
export * from "./system";
export * from "./actions";
export * from "./blocks";
export * from "./service";
export * from "./serviceCalls";
export * from "./contract";
export * from "./bridge";
export * from "./channels";
export * from "./protocol";
export * from "./shell";
export * from "./widgetManifest";
export { defineWidgets, type WidgetContext, type WidgetMount } from "./widget";
export { getWidgetChoices } from "./widgetChoices";

/** a shell this computer has, as terminalApi.shells() lists it */
export interface TerminalShell {
    /** the program; pass it as create()'s shell */
    path: string;
    /** what the user calls it ("zsh", "PowerShell 7") */
    name: string;
}

/** a command a terminal's shell ran, once it has ended */
export interface TerminalCommand {
    /** the command line as typed; "" when the shell didn't keep it */
    command: string;
    exitCode: number;
}

// terminal management
export const terminalApi = {
    /**
     * Terminal identity is the explicit argument: options cannot clobber it.
     * shell is one of shells()'s paths; without it, the computer's default.
     */
    create: (
        id: string,
        options?: {
            cols?: number;
            rows?: number;
            cwd?: string;
            env?: Record<string, string>;
            shell?: string;
        },
    ): Promise<void> => send("terminal-create", { ...options, id }),

    /** the shells a terminal can start with on this computer, its default first */
    shells: (): Promise<TerminalShell[]> => invoke<TerminalShell[]>("terminal-shells"),

    write: (id: string, data: string): Promise<void> =>
        send("terminal-write", { id, data }),

    resize: (id: string, cols: number, rows: number): Promise<void> =>
        send("terminal-resize", { id, cols, rows }),

    destroy: (id: string): Promise<void> => send("terminal-destroy", { id }),

    exists: async (id: string): Promise<boolean> =>
        invoke<boolean>("terminal-exists", { id }),

    onData: (id: string, callback: (data: string) => void): StreamSubscription => {
        return on(`terminal-data:${id}`, (_event: unknown, data: unknown) => {
            if (typeof data === "string" && data) callback(data);
        });
    },

    /**
     * The program in front of the terminal (its shell at the prompt, or
     * what the shell runs), each time it changes and once on subscribing.
     */
    onForeground: (id: string, callback: (name: string) => void): StreamSubscription => {
        return on(`terminal-foreground:${id}`, (_event: unknown, name: unknown) => {
            if (typeof name === "string" && name) callback(name);
        });
    },

    /**
     * Each command the terminal's shell runs, when it ends. bash, zsh, fish
     * and PowerShell say so; another shell (sh, cmd) says nothing.
     */
    onCommand: (id: string, callback: (finished: TerminalCommand) => void): StreamSubscription => {
        return on(`terminal-command:${id}`, (_event: unknown, finished: unknown) => {
            if (finished && typeof finished === "object") callback(finished as TerminalCommand);
        });
    },

    /** the folder the terminal's shell is in, each time it changes and once on subscribing */
    onCwd: (id: string, callback: (cwd: string) => void): StreamSubscription => {
        return on(`terminal-cwd:${id}`, (_event: unknown, cwd: unknown) => {
            if (typeof cwd === "string" && cwd) callback(cwd);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void): StreamSubscription => {
        return on(`terminal-exit:${id}`, (_event: unknown, exit: { exitCode?: number }) => {
            callback(exit.exitCode);
        });
    },
};

export const terminal = terminalApi;
