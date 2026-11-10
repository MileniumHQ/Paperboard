// The embedding Paperboard shell, as the library's bridge sees it: a
// transport that records what the library sends and delivers the shell's
// messages back, exactly as the iframe's window host would.
import type { BridgeHost } from "../../src/bridge";

export interface ShellMessage {
    type: string;
    requestId?: string;
    panelId?: string;
    [key: string]: unknown;
}

export interface Shell extends BridgeHost {
    sent: ShellMessage[];
    /** Deliver a message from the shell to the library. */
    reply(message: unknown): void;
    listening(): boolean;
    /** Resolves with the first message of this type the library sends. */
    next(type: string): Promise<ShellMessage>;
}

export function shell(): Shell {
    const sent: ShellMessage[] = [];
    const listeners = new Set<(data: unknown) => void>();
    const waiters: { type: string; resolve: (m: ShellMessage) => void }[] = [];
    return {
        sent,
        send(data) {
            const message = data as ShellMessage;
            sent.push(message);
            for (const waiter of waiters.filter((w) => w.type === message.type)) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(message);
            }
        },
        listen(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        reply(message) {
            for (const listener of [...listeners]) listener(message);
        },
        listening: () => listeners.size > 0,
        next(type) {
            const already = sent.find((m) => m.type === type);
            if (already) return Promise.resolve(already);
            return new Promise((resolve) => waiters.push({ type, resolve }));
        },
    };
}
