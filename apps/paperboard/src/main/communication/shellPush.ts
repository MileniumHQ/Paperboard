// Shell event fan-out: main-process pushes (computers-changed,
// discovery-changed) go to every attached shell host — Electron windows
// and browser-mode tabs alike. Each host registers one sink and removes it
// on teardown, so the set is bounded by the number of live hosts.
export type ShellPushSink = (channel: string, payload: unknown) => void;

const sinks = new Set<ShellPushSink>();

export function addShellPushSink(sink: ShellPushSink): () => void {
    sinks.add(sink);
    return () => {
        sinks.delete(sink);
    };
}

export function pushToShells(channel: string, payload: unknown): void {
    for (const sink of sinks) sink(channel, payload);
}
