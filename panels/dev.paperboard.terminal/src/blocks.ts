// Terminal's blocks for the Blocks panel (Actions API v2). The actions (v1,
// service.ts) stay as they are; both run the same functions, which the
// service hands in here.
import type { BlockSet, BlocksHandle } from "@mileniumhq/paperapi";
import { MAX_COMMAND_LENGTH, MAX_LABEL_LENGTH, type CommandRun, type SavedCommand } from "./lib/savedCommands";

/** What the blocks do, as the service does it. */
export interface TerminalBlocksHost {
    /** the tabs' ids, in tab-bar order */
    tabs(): string[];
    /** throws for a tab that isn't open */
    tabLabel(id: string): string;
    /** the tab last shown, which a new window opens on; throws when no tab is open */
    activeTab(): string;
    /** switches every open Terminal window to the tab */
    showTab(id: string): Promise<void>;
    /** moves the tab to a place in the tab bar, 1 being the first */
    moveTab(id: string, position: number): Promise<void>;
    createTab(label?: string): Promise<string>;
    renameTab(id: string, label: string): Promise<void>;
    closeTab(id: string): Promise<void>;
    /** keystrokes to the tab's shell, as typed */
    write(id: string, text: string): Promise<unknown>;
    readOutput(id: string, lines?: number): string;
    runShellCommand(command: string): Promise<string>;
    /** the saved commands' ids, in the panel's order */
    savedCommands(): string[];
    /** throws for a command that isn't saved */
    savedCommand(id: string): SavedCommand;
    savedCommandRunning(id: string): boolean;
    /** the command's current or last run; none when it has not run */
    savedCommandRun(id: string): CommandRun | undefined;
    saveCommand(label: string | undefined, command: string): Promise<string>;
    removeSavedCommand(id: string): Promise<void>;
    runSavedCommand(id: string): Promise<void>;
    /** resolves once the run ended; throws when it isn't running */
    stopSavedCommand(id: string): Promise<void>;
}

const CATEGORY = { tabs: "Tabs", shell: "Shell", saved: "Saved Commands" };

export function terminalBlocks(host: TerminalBlocksHost): BlockSet {
    return {
        categories: [
            { name: CATEGORY.tabs, icon: "tab" },
            { name: CATEGORY.shell, icon: "terminal" },
            { name: CATEGORY.saved, icon: "bookmarks" },
        ],
        types: [
            {
                id: "tab",
                name: "Tab",
                icon: "terminal",
                description: "A terminal tab, and the shell running in it",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (id: string) => host.tabLabel(id) },
                },
            },
            {
                id: "saved-command",
                name: "Saved Command",
                icon: "bookmark",
                description: "A command saved in the Terminal panel",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (id: string) => host.savedCommand(id).label },
                    command: { type: "text", name: "Command", resolve: (id: string) => host.savedCommand(id).command },
                    running: { type: "boolean", name: "Running", resolve: (id: string) => host.savedCommandRunning(id) },
                    "last-result": {
                        type: "text",
                        name: "Last Result",
                        description: "How its last run went: Running, Exit 0, Stopped, Timed out, why it failed, or Not run yet",
                        resolve: (id: string) => lastResult(host.savedCommandRun(id)),
                    },
                    "last-exit-code": {
                        type: "number",
                        name: "Last Exit Code",
                        description: "None while it runs, before it has run, or when its last run ended without one",
                        optional: true,
                        resolve: (id: string) => {
                            const run = host.savedCommandRun(id);
                            return run?.state === "exited" ? run.exitCode : null;
                        },
                    },
                },
            },
        ],
        values: [
            {
                id: "tabs",
                name: "Tabs",
                category: CATEGORY.tabs,
                icon: "tab",
                description: "The open terminal tabs, in tab-bar order",
                type: "list<tab>",
                changes: true,
                read: () => host.tabs(),
            },
            {
                id: "active-tab",
                name: "Active Tab",
                category: CATEGORY.tabs,
                icon: "tab",
                description: "The tab last shown in the Terminal panel, which a new window opens on",
                type: "tab",
                changes: true,
                read: () => host.activeTab(),
            },
            {
                id: "output",
                name: "Tab Output",
                category: CATEGORY.tabs,
                icon: "article",
                description: "The last lines a tab's shell printed",
                text: "last {lines} lines of {tab}",
                inputs: {
                    lines: { type: "number", name: "Lines", integer: true, min: 1, max: 1000 },
                    tab: { type: "tab", name: "Tab" },
                },
                type: "text",
                read: ({ tab, lines }: { tab: string; lines: number }) => host.readOutput(tab, lines),
            },
            {
                id: "saved-commands",
                name: "Saved Commands",
                category: CATEGORY.saved,
                icon: "bookmarks",
                description: "The commands saved in the Terminal panel",
                type: "list<saved-command>",
                changes: true,
                read: () => host.savedCommands(),
            },
        ],
        commands: [
            {
                id: "new-tab",
                name: "New Tab",
                category: CATEGORY.tabs,
                icon: "add",
                description: "Opens a terminal tab with a shell of its own",
                text: "open a new tab named {name}",
                inputs: { name: { type: "text", name: "Name", optional: true } },
                output: "tab",
                run: ({ name }: { name?: string }) => host.createTab(name),
            },
            {
                id: "rename-tab",
                name: "Rename Tab",
                category: CATEGORY.tabs,
                icon: "edit",
                text: "rename {tab} to {name}",
                inputs: {
                    tab: { type: "tab", name: "Tab" },
                    name: { type: "text", name: "Name" },
                },
                run: ({ tab, name }: { tab: string; name: string }) => host.renameTab(tab, name),
            },
            {
                id: "show-tab",
                name: "Show Tab",
                category: CATEGORY.tabs,
                icon: "visibility",
                description: "Switches the open Terminal windows to the tab, and makes it the Active Tab",
                text: "show {tab}",
                inputs: { tab: { type: "tab", name: "Tab" } },
                run: ({ tab }: { tab: string }) => host.showTab(tab),
            },
            {
                id: "move-tab",
                name: "Move Tab",
                category: CATEGORY.tabs,
                icon: "swap_horiz",
                description: "Moves the tab to a place in the tab bar; 1 is the first",
                text: "move {tab} to position {position}",
                inputs: {
                    tab: { type: "tab", name: "Tab" },
                    position: { type: "number", name: "Position", integer: true, min: 1 },
                },
                run: ({ tab, position }: { tab: string; position: number }) => host.moveTab(tab, position),
            },
            {
                id: "close-tab",
                name: "Close Tab",
                category: CATEGORY.tabs,
                icon: "close",
                description: "Ends the tab's shell and deletes what it printed",
                text: "close {tab}",
                inputs: { tab: { type: "tab", name: "Tab" } },
                run: ({ tab }: { tab: string }) => host.closeTab(tab),
            },
            {
                id: "run-in-tab",
                name: "Run in Tab",
                category: CATEGORY.tabs,
                icon: "keyboard_return",
                description: "Types a command into the tab's shell and presses Enter",
                text: "run {command} in {tab}",
                inputs: {
                    command: { type: "text", name: "Command" },
                    tab: { type: "tab", name: "Tab" },
                },
                run: async ({ command, tab }: { command: string; tab: string }) => void (await host.write(tab, `${command}\r`)),
            },
            {
                id: "type-in-tab",
                name: "Type in Tab",
                category: CATEGORY.tabs,
                icon: "keyboard",
                description: "Sends keystrokes to the tab's shell, without pressing Enter",
                text: "type {text} into {tab}",
                inputs: {
                    text: { type: "text", name: "Text" },
                    tab: { type: "tab", name: "Tab" },
                },
                run: async ({ text, tab }: { text: string; tab: string }) => void (await host.write(tab, text)),
            },
            {
                id: "run-shell-command",
                name: "Run Shell Command",
                category: CATEGORY.shell,
                icon: "terminal",
                description: "Runs a command in a shell of its own, waits for it, and gives back its standard output; fails if it exits with an error",
                text: "output of running {command}",
                inputs: { command: { type: "text", name: "Command" } },
                output: "text",
                run: ({ command }: { command: string }) => host.runShellCommand(command),
            },
            {
                id: "save-command",
                name: "Save Command",
                category: CATEGORY.saved,
                icon: "bookmark_add",
                description: "Saves a command to run later from the panel or Home",
                text: "save {command} as {name}",
                inputs: {
                    command: { type: "text", name: "Command", maxLength: MAX_COMMAND_LENGTH },
                    name: { type: "text", name: "Name", optional: true, maxLength: MAX_LABEL_LENGTH },
                },
                output: "saved-command",
                run: ({ command, name }: { command: string; name?: string }) => host.saveCommand(name, command),
            },
            {
                id: "remove-saved-command",
                name: "Remove Saved Command",
                category: CATEGORY.saved,
                icon: "bookmark_remove",
                text: "remove {command}",
                inputs: { command: { type: "saved-command", name: "Saved Command" } },
                run: ({ command }: { command: string }) => host.removeSavedCommand(command),
            },
            {
                id: "run-saved-command",
                name: "Run Saved Command",
                category: CATEGORY.saved,
                icon: "play_arrow",
                description: "Starts a saved command without waiting for it; When a Saved Command Finishes says how it ended",
                text: "start {command}",
                inputs: { command: { type: "saved-command", name: "Saved Command" } },
                run: ({ command }: { command: string }) => host.runSavedCommand(command),
            },
            {
                id: "stop-saved-command",
                name: "Stop Saved Command",
                category: CATEGORY.saved,
                icon: "stop",
                description: "Stops a saved command that is running, and waits for it to end",
                text: "stop {command}",
                inputs: { command: { type: "saved-command", name: "Saved Command" } },
                run: ({ command }: { command: string }) => host.stopSavedCommand(command),
            },
        ],
        events: [
            {
                id: "tab-opened",
                name: "When a Tab Opens",
                category: CATEGORY.tabs,
                icon: "add",
                description: "Fires when a terminal tab is opened, from the panel or a block",
                text: "when a tab opens",
                values: {
                    tab: { type: "tab", name: "Tab" },
                    name: { type: "text", name: "Name" },
                },
            },
            {
                id: "tab-closed",
                name: "When a Tab Closes",
                category: CATEGORY.tabs,
                icon: "close",
                description: "Fires when a terminal tab is closed; the tab is gone, so its Name is given here",
                text: "when {tab} closes",
                inputs: { tab: { type: "tab", name: "Tab", optional: true } },
                filters: { tab: "tab" },
                values: {
                    tab: { type: "tab", name: "Tab" },
                    name: { type: "text", name: "Name" },
                },
            },
            {
                id: "terminal-exit",
                name: "When a Tab's Shell Ends",
                category: CATEGORY.tabs,
                icon: "logout",
                description: "Fires when the shell in a tab exits",
                text: "when the shell in {tab} ends",
                inputs: { tab: { type: "tab", name: "Tab", optional: true } },
                filters: { tab: "tab" },
                values: {
                    tab: { type: "tab", name: "Tab" },
                    succeeded: { type: "boolean", name: "Succeeded", description: "It exited with code 0" },
                    "exit-code": { type: "number", name: "Exit Code", description: "None when the shell ended without one, as when it crashed", optional: true },
                    result: { type: "text", name: "Result", description: "How it ended, such as Exit 1" },
                },
            },
            {
                id: "saved-command-finished",
                name: "When a Saved Command Finishes",
                category: CATEGORY.saved,
                icon: "flag",
                description: "Fires when a run of a saved command ends: it exited, timed out or failed",
                text: "when {command} finishes",
                inputs: { command: { type: "saved-command", name: "Saved Command", optional: true } },
                filters: { command: "command" },
                values: {
                    command: { type: "saved-command", name: "Saved Command" },
                    succeeded: { type: "boolean", name: "Succeeded", description: "It exited with code 0" },
                    "exit-code": { type: "number", name: "Exit Code", description: "None when it was stopped, timed out or failed to start", optional: true },
                    result: { type: "text", name: "Result", description: "How it ended: Exit 0, Stopped, Timed out, or why it failed" },
                },
            },
        ],
    };
}

/** How a shell that exited reads in its event. */
export function exitPayload(tab: string, exitCode: number | undefined) {
    return {
        tab,
        succeeded: exitCode === 0,
        "exit-code": typeof exitCode === "number" ? exitCode : null,
        result: typeof exitCode === "number" ? `Exit ${exitCode}` : "Ended without an exit code",
    };
}

/** How a tab that opened or closed reads in its event. */
export function tabPayload(tab: { id: string; label: string }) {
    return { tab: tab.id, name: tab.label };
}

/** How a run that ended reads: Exit 0, Stopped, Timed out, or why it failed. */
function endedResult(outcome: Exclude<CommandRun, { state: "running" }>): string {
    switch (outcome.state) {
        case "exited":
            return `Exit ${outcome.exitCode}`;
        case "stopped":
            return "Stopped";
        case "timed-out":
            return "Timed out";
        case "failed":
            return outcome.error;
    }
}

/** A saved command's Last Result: its run as it stands, or that it has not run. */
export function lastResult(run: CommandRun | undefined): string {
    if (!run) return "Not run yet";
    return run.state === "running" ? "Running" : endedResult(run);
}

/** How a finished run reads in its event. */
export function finishedPayload(command: SavedCommand, outcome: Exclude<CommandRun, { state: "running" }>) {
    return {
        command: command.id,
        succeeded: outcome.state === "exited" && outcome.exitCode === 0,
        "exit-code": outcome.state === "exited" ? outcome.exitCode : null,
        result: endedResult(outcome),
    };
}

/**
 * Tells the Blocks panel what happened. Until the blocks are registered
 * nothing can listen, so nothing is sent; after, a list announces a change
 * only when its ids did, and every failure is reported.
 */
export class BlocksAnnouncer {
    private registered = false;
    private readonly last = new Map<string, string>();

    constructor(private readonly handle: BlocksHandle) {}

    async register(set: BlockSet, lists: Record<string, string[]>): Promise<void> {
        await this.handle.register(set);
        for (const [value, ids] of Object.entries(lists)) this.last.set(value, JSON.stringify(ids));
        this.registered = true;
    }

    list(value: string, ids: string[]): void {
        if (!this.registered) return;
        const key = JSON.stringify(ids);
        if (this.last.get(value) === key) return;
        this.last.set(value, key);
        this.handle.changed(value).catch((err) => console.error(`[TerminalService] the change to ${value} did not reach Blocks:`, err));
    }

    /** Resolves once the event reached Blocks, or was reported as not reaching it. */
    fire(event: string, payload: Record<string, unknown>): Promise<void> {
        if (!this.registered) return Promise.resolve();
        return this.handle.fire(event, payload).catch((err) => console.error(`[TerminalService] ${event} did not reach Blocks:`, err));
    }
}
