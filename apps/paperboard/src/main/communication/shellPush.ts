// Shell event fan-out: main-process pushes (computers-changed,
// discovery-changed) go to every attached shell host — Electron windows
// and browser-mode tabs alike. Each host registers one sink and removes it
// on teardown, so the set is bounded by the number of live hosts. Each push
// carries the payload its channel declares (shared/shellContract.ts).
import type { WebContents } from "electron";
import type { PushPayload, ShellPush } from "../../shared/shellContract";

export type ShellPushSink = (channel: ShellPush, payload: unknown) => void;

const sinks = new Set<ShellPushSink>();

export function addShellPushSink(sink: ShellPushSink): () => void {
    sinks.add(sink);
    return () => {
        sinks.delete(sink);
    };
}

export function pushToShells<K extends ShellPush>(channel: K, payload: PushPayload<K>): void {
    for (const sink of sinks) sink(channel, payload);
}

/** a push to the one window it concerns */
export function pushToWindow<K extends ShellPush>(wc: WebContents, channel: K, payload: PushPayload<K>): void {
    wc.send(channel, payload);
}
