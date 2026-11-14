import { currentFrameSession } from "./frameSession";

// Unsaved work on a panel page. The page tells its shell when it has some
// and when it no longer does; while it has some, the shell keeps the page
// loaded, and before it takes the page away (a restart, an uninstall,
// forgetting the computer) it asks the page, which asks the person.

/** page to shell: whether this document holds unsaved work */
export const UNSAVED_CHANGES_MESSAGE = "paperboard:unsaved-changes";
/** shell to page: may this document go? */
export const LEAVE_REQUEST_MESSAGE = "paperboard:leave-request";
/** page to shell: the answer to a LEAVE_REQUEST_MESSAGE */
export const LEAVE_ANSWER_MESSAGE = "paperboard:leave-answer";

export interface UnsavedChangesMessage {
    type: typeof UNSAVED_CHANGES_MESSAGE;
    generation: string;
    unsaved: boolean;
}

export interface LeaveAnswerMessage {
    type: typeof LEAVE_ANSWER_MESSAGE;
    generation: string;
    requestId: string;
    /** true: the page may go; false: the person chose to stay */
    leave: boolean;
    /** why the page couldn't ask; the page stays */
    error?: string;
}

let confirmLeave: (() => Promise<boolean>) | null = null;

const tell = (generation: string, unsaved: boolean) => {
    window.parent.postMessage({ type: UNSAVED_CHANGES_MESSAGE, generation, unsaved } satisfies UnsavedChangesMessage, "*");
};

const answer = async (requestId: string, generation: string) => {
    const reply = (fields: { leave: boolean; error?: string }) => {
        window.parent.postMessage({ type: LEAVE_ANSWER_MESSAGE, generation, requestId, ...fields } satisfies LeaveAnswerMessage, "*");
    };
    const ask = confirmLeave;
    if (!ask) return reply({ leave: true });
    try {
        reply({ leave: (await ask()) === true });
    } catch (err) {
        console.error("[paperapi] asking about unsaved changes failed:", err);
        reply({ leave: false, error: err instanceof Error ? err.message : String(err) });
    }
};

if (typeof window !== "undefined" && window.parent !== window) {
    const receive = (event: MessageEvent) => {
        const data = event.data;
        const session = currentFrameSession();
        if (event.source !== window.parent || !session || session.widget || data?.generation !== session.generation) return;
        // readiness.ts, imported first, has taken the challenge's generation:
        // work marked unsaved before the shell asked is told under it
        if (data.type === "paperboard:initialize" && confirmLeave) tell(session.generation, true);
        else if (data.type === LEAVE_REQUEST_MESSAGE && typeof data.requestId === "string") void answer(data.requestId, session.generation);
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => window.removeEventListener("message", receive), { once: true });
}

/**
 * Tells the shell whether this panel page holds unsaved work. Pass the
 * function that asks the person what happens to it (save, discard or stay)
 * while there is some, and null once there is none. The function resolves
 * true when the page may go, false to stay; PaperFileBrowser's
 * `confirmLeave` fits.
 *
 * While a page has unsaved work, the shell keeps it loaded, and before it
 * restarts the panel, uninstalls it or forgets its computer, it shows the
 * page and calls the function. Outside a panel frame this does nothing.
 */
export function setUnsavedChanges(confirm: (() => Promise<boolean>) | null): void {
    if (typeof window === "undefined" || window.parent === window) return;
    const session = currentFrameSession();
    if (session?.widget) throw new Error("setUnsavedChanges is for a panel page; a widget is never asked before it goes");
    const changed = (confirmLeave !== null) !== (confirm !== null);
    confirmLeave = confirm;
    // before the shell's challenge there is no one to tell yet: the challenge tells it
    if (changed && session) tell(session.generation, confirm !== null);
}
