// Main asks a shell window something only the person can answer (a panel
// permission, whether unsaved work may go) and waits for that window's
// answer. Only the window asked can answer, and only on the channel asked.
import { randomUUID } from "crypto";
import type { WebContents } from "electron";
import type { PushPayload } from "../shared/shellContract";
import { pushToWindow } from "./communication/shellPush";

type AskChannel = "quit-ask" | "panel-permission-ask" | "panel-screen-pick";

const GONE = ["destroyed", "render-process-gone", "did-navigate"] as const;
const pending = new Map<string, { wc: WebContents; channel: AskChannel; settle: (value: unknown) => void }>();

/** Ask the shell in `wc` on `channel` what `ask` says under its id; null when the window goes away, or loads again, before it answers. */
export function askShell<K extends AskChannel>(wc: WebContents | null, channel: K, ask: (askId: string) => PushPayload<K>): Promise<unknown> {
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error("there's no window to ask in"));
    const askId = randomUUID();
    return new Promise((resolve) => {
        const gone = () => settle(null);
        const settle = (value: unknown) => {
            if (!pending.delete(askId)) return;
            for (const event of GONE) wc.off(event as "destroyed", gone);
            resolve(value);
        };
        pending.set(askId, { wc, channel, settle });
        // a reloaded shell has forgotten the question
        for (const event of GONE) wc.once(event as "destroyed", gone);
        pushToWindow(wc, channel, ask(askId));
    });
}

/** The shell's answer to an ask made on one of `channels`. */
export function answerShellAsk(sender: WebContents, channels: readonly AskChannel[], answer: { askId: string; answer: unknown }): void {
    const ask = pending.get(answer.askId);
    if (!ask || !channels.includes(ask.channel)) throw new Error("That question was already answered, or never asked");
    if (ask.wc !== sender) throw new Error("Only the window that was asked can answer");
    ask.settle(answer.answer);
}
