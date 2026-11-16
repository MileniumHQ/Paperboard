// The terminal's tabs, as the service keeps them and every window mirrors
// them. A tab holds one shell, or two side by side when it is split; each
// shell is a session with an id of its own.
import type { LiveSession, SessionErrorKind, TabLayout, TerminalSession, TerminalTab } from "./contract";

export const SESSION_ERROR_TITLES: Record<SessionErrorKind, string> = {
    start: "Shell not started",
    scrollback: "Output not saved",
    folder: "Folder not saved",
    size: "Screen size not sent",
};

const DEFAULT_LABEL = /^Tab \d+$/;

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
 * What a tab is called: its name when it was given one, with what is
 * running in it ("Server — java"); otherwise what is running alone, as a
 * terminal's title shows it. What is running is the command line the shell
 * marked as running, as typed, or else the program in front. A tab whose
 * shell hasn't started yet goes by its label.
 */
export function tabTitle(
    tab: TerminalTab,
    live: Record<string, LiveSession>,
    running: Record<string, string | null> = {},
    focused: string = tab.id,
): string {
    const program = sessionTitle(focused, live, running) || sessionTitle(tab.id, live, running);
    if (!program) return tab.label;
    return tab.named ? `${tab.label} — ${program}` : program;
}

/** what is running in one shell: the command line it marked, or the program in front; "" before it starts */
export function sessionTitle(session: string, live: Record<string, LiveSession>, running: Record<string, string | null>): string {
    return running[session] || live[session]?.program || "";
}

/** the most characters a tab along the top shows of its title; a longer one ends in an ellipsis */
export const TAB_TITLE_CHARS = 28;

/** a title cut to fit a tab along the top (a tab down the side clips its own) */
export function shortTitle(title: string): string {
    const chars = [...title];
    return chars.length <= TAB_TITLE_CHARS ? title : `${chars.slice(0, TAB_TITLE_CHARS - 1).join("").trimEnd()}…`;
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
