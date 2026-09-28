// Browser-mode stand-in for the Electron preload bridge: the same
// invoke/send/on surface, carried over the host's HTTP bridge
// (src/main/browserHost.ts) instead of IPC. Invokes reject with the
// handler's message exactly like a failed ipcRenderer.invoke.
type Listener = (event: unknown, ...args: any[]) => void;

export interface ShellIpc {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: Listener): void;
    once(channel: string, listener: Listener): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
}

async function post(kind: "invoke" | "send", channel: string, args: unknown[]): Promise<Response> {
    const res = await fetch(`/_shell/${kind}/${encodeURIComponent(channel)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
    });
    if (!res.ok) {
        throw new Error(`[shell] ${channel} failed: HTTP ${res.status} ${await res.text()}`);
    }
    return res;
}

export function createBrowserBridge(): ShellIpc {
    const listeners = new Map<string, Set<Listener>>();
    const attached = new Set<string>();
    let source: EventSource | null = null;

    const attach = (channel: string) => {
        source ??= new EventSource("/_shell/events");
        if (attached.has(channel)) return;
        attached.add(channel);
        source.addEventListener(channel, (message) => {
            let payload: unknown;
            try {
                payload = JSON.parse((message as MessageEvent).data);
            } catch (err) {
                console.error(`[shell] unreadable ${channel} event:`, err);
                return;
            }
            for (const listener of listeners.get(channel) ?? []) listener({}, payload);
        });
    };

    const bridge: ShellIpc = {
        async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            const res = await post("invoke", channel, args);
            const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
            if (!body.ok) throw new Error(body.error || `${channel} failed`);
            return body.result as T;
        },
        send(channel: string, ...args: unknown[]) {
            void post("send", channel, args).catch((err) => console.error(err));
        },
        on(channel: string, listener: Listener) {
            attach(channel);
            let set = listeners.get(channel);
            if (!set) listeners.set(channel, (set = new Set()));
            set.add(listener);
        },
        once(channel: string, listener: Listener) {
            const wrapped: Listener = (event, ...args) => {
                bridge.removeListener(channel, wrapped);
                listener(event, ...args);
            };
            bridge.on(channel, wrapped);
        },
        removeListener(channel: string, listener: (...args: any[]) => void) {
            listeners.get(channel)?.delete(listener);
        },
        removeAllListeners(channel: string) {
            listeners.delete(channel);
        },
    };
    return bridge;
}
