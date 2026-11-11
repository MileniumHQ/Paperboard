// The terminal's tabs, as the service keeps them and every window mirrors
// them. A tab holds one shell, or two side by side when it is split; each
// shell is a session with an id of its own.

export type TabLayout = "horizontal" | "vertical";
export type SplitDirection = "right" | "down";

export interface TerminalSession {
    id: string;
    /** the shell it starts with, one of terminalApi.shells(); the computer's default when absent */
    shell?: string;
    /** the folder its shell was last in; a new shell for it starts there */
    cwd?: string;
}

export interface TerminalTab extends TerminalSession {
    label: string;
    /**
     * The label was chosen: the tab was named when it opened, or renamed.
     * An unnamed tab is called by the program in front of it.
     */
    named?: boolean;
    /** a second shell beside the first */
    split?: { direction: SplitDirection; session: TerminalSession };
}

/** what a session's shell has said since it started */
export interface LiveSession {
    /** the program in front of it ("" until the shell is running) */
    program: string;
    /** the folder its shell is in ("" until it says) */
    cwd: string;
    /** the last command it ran; seq grows with every command any shell runs */
    command?: { line: string; exitCode: number; seq: number };
}

export const DEFAULT_LABEL = /^Tab \d+$/;

export function tabSessions(tab: TerminalTab): TerminalSession[] {
    return tab.split ? [tab, tab.split.session] : [tab];
}

/** the tab a session belongs to, and the session itself */
export function findSession(tabs: TerminalTab[], id: string): { tab: TerminalTab; session: TerminalSession } | undefined {
    for (const tab of tabs) {
        for (const session of tabSessions(tab)) {
            if (session.id === id) return { tab, session };
        }
    }
    return undefined;
}

/**
 * What a tab is called: its name when it was given one, with the program
 * running in it ("Server — java"); otherwise the program alone, as a
 * terminal's title shows it. A tab whose shell hasn't started yet goes by
 * its label.
 */
export function tabTitle(tab: TerminalTab, live: Record<string, LiveSession>, focused: string = tab.id): string {
    const program = live[focused]?.program || live[tab.id]?.program || "";
    if (!program) return tab.label;
    return tab.named ? `${tab.label} — ${program}` : program;
}

function readSession(raw: any): TerminalSession | null {
    if (!raw || typeof raw.id !== "string" || !raw.id) return null;
    const session: TerminalSession = { id: raw.id };
    if (typeof raw.shell === "string" && raw.shell) session.shell = raw.shell;
    if (typeof raw.cwd === "string" && raw.cwd) session.cwd = raw.cwd;
    return session;
}

/**
 * The tabs as tabs.json holds them. A tab saved before tabs had names of
 * their own counts as named unless it still has its default label.
 */
export function readSavedTabs(raw: unknown): TerminalTab[] {
    if (!Array.isArray(raw)) return [];
    const out: TerminalTab[] = [];
    for (const item of raw) {
        const session = readSession(item);
        if (!session || typeof item.label !== "string") continue;
        const tab: TerminalTab = { ...session, label: item.label };
        const named = typeof item.named === "boolean" ? item.named : !DEFAULT_LABEL.test(item.label);
        if (named) tab.named = true;
        const split = item.split;
        const splitSession = split && (split.direction === "right" || split.direction === "down") ? readSession(split.session) : null;
        if (splitSession) tab.split = { direction: split.direction, session: splitSession };
        out.push(tab);
    }
    return out;
}

export function readLayout(raw: unknown): TabLayout {
    return raw === "vertical" ? "vertical" : "horizontal";
}
