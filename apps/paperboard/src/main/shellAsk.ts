// Main asks a shell window something only the person can answer (a panel
// permission, whether unsaved work may go) and waits for that window's
// answer. Only the window asked can answer, and only on the channel asked.
import { randomUUID } from "crypto";
import type { WebContents } from "electron";

const pending = new Map<string, { wc: WebContents; channel: string; settle: (value: unknown) => void }>();

/** Ask the shell in `wc` on `channel`; null when the window goes away before it answers. */
export function askShell(wc: WebContents | null, channel: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error("there's no window to ask in"));
    const askId = randomUUID();
    return new Promise((resolve) => {
        const gone = () => settle(null);
        const settle = (value: unknown) => {
            if (!pending.delete(askId)) return;
            wc.off("destroyed", gone);
            wc.off("render-process-gone", gone);
            resolve(value);
        };
        pending.set(askId, { wc, channel, settle });
        wc.once("destroyed", gone);
        wc.once("render-process-gone", gone);
        wc.send(channel, { askId, ...payload });
    });
}

/** The shell's answer to an ask made on one of `channels`. */
export function answerShellAsk(sender: WebContents, channels: readonly string[], args: unknown): void {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const ask = typeof a.askId === "string" ? pending.get(a.askId) : undefined;
    if (!ask || !channels.includes(ask.channel)) throw new Error("That question was already answered, or never asked");
    if (ask.wc !== sender) throw new Error("Only the window that was asked can answer");
    ask.settle(a.answer ?? null);
}
