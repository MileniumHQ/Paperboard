// What a tab that isn't shown has done since it was last looked at, in this
// window: printed lately, ended a command, or rang the bell.
import { createEffect, on, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { LoaderStatus } from "@mileniumhq/paperui";
import { tabSessions, type LiveSession, type TerminalTab } from "./tabs";

// how long a hidden tab counts as busy after it last printed
const BUSY_MS = 1500;

interface Attention {
    /** printed in the last moments */
    busy?: boolean;
    /** a command ended: how */
    finished?: "success" | "error";
    /** rang the bell */
    bell?: boolean;
}

export function createAttention(tabs: () => TerminalTab[], activeTab: () => string) {
    const [attention, setAttention] = createStore<Record<string, Attention>>({});
    const busyTimers = new Map<string, ReturnType<typeof setTimeout>>();
    onCleanup(() => busyTimers.forEach(clearTimeout));

    const ownerOf = (session: string) => tabs().find((t) => tabSessions(t).some((s) => s.id === session));
    const notice = (session: string, change: Attention) => {
        const tab = ownerOf(session);
        if (!tab || tab.id === activeTab()) return;
        setAttention(tab.id, (prev) => ({ ...prev, ...change }));
        return tab.id;
    };
    // the commands this window has seen end, so only new ones are told
    const seenCommand: Record<string, number> = {};
    let commandsSeen = false;

    // looking at a tab is seeing what it did
    createEffect(on(activeTab, (id) => id && setAttention(id, { busy: undefined, finished: undefined, bell: undefined })));

    return {
        ownerOf,
        /** the session printed while it was hidden */
        output(session: string) {
            const tabId = notice(session, { busy: true });
            if (!tabId) return;
            clearTimeout(busyTimers.get(tabId));
            busyTimers.set(tabId, setTimeout(() => setAttention(tabId, "busy", false), BUSY_MS));
        },
        bell(session: string) {
            notice(session, { bell: true });
        },
        /** what the shells said: a command that ended since this window last heard is news */
        live(next: Record<string, LiveSession>) {
            for (const [session, state] of Object.entries(next)) {
                const seq = state.command?.seq ?? 0;
                if (seq <= (seenCommand[session] ?? 0)) continue;
                seenCommand[session] = seq;
                // what had ended before this window opened is not news
                if (commandsSeen) notice(session, { finished: state.command!.exitCode === 0 ? "success" : "error" });
            }
            commandsSeen = true;
        },
        rang: (tabId: string) => Boolean(attention[tabId]?.bell),
        status(tabId: string): LoaderStatus | undefined {
            const a = attention[tabId];
            if (a?.busy) return "indeterminate";
            return a?.finished;
        },
    };
}
