// Browser-mode stand-in for the Electron preload bridge: the same wire
// (ShellWire in shared/shellContract.ts), carried over the host's HTTP
// bridge (src/main/browserHost.ts) instead of IPC. Invokes reject with the
// handler's message exactly like a failed ipcRenderer.invoke.
import type { ShellWire } from "../../../shared/shellContract";

type Listener = (payload: unknown) => void;

async function post(kind: "invoke" | "send", channel: string, args: unknown): Promise<Response> {
    const res = await fetch(`/_shell/${kind}/${encodeURIComponent(channel)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
    });
    if (res.status === 401) {
        // the session ended (expired, or signed out in another tab): the
        // signed-out page says how to get back in
        location.assign("/signed-out.html?reason=ended");
    }
    if (!res.ok) {
        throw new Error(`[shell] ${channel} failed: HTTP ${res.status} ${await res.text()}`);
    }
    return res;
}

export function createBrowserBridge(): ShellWire {
    const listeners = new Map<string, Set<Listener>>();
    let source: EventSource | null = null;

    const attach = (channel: string) => {
        source ??= new EventSource("/_shell/events");
        source.addEventListener(channel, (message) => {
            let payload: unknown;
            try {
                payload = JSON.parse((message as MessageEvent).data);
            } catch (err) {
                // quiet: dev browser mode only: a malformed event from the dev server has no action to fail
                console.error(`[shell] unreadable ${channel} event:`, err);
                return;
            }
            for (const listener of listeners.get(channel) ?? []) listener(payload);
        });
    };

    return {
        async invoke(channel, args) {
            const res = await post("invoke", channel, args);
            const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
            if (!body.ok) throw new Error(body.error || `${channel} failed`);
            return body.result;
        },
        send(channel, args) {
            // quiet: send() mirrors ipcRenderer.send, which has no answer to fail with; dev browser mode only
            void post("send", channel, args).catch((err) => console.error(err));
        },
        on(channel, listener) {
            let set = listeners.get(channel);
            if (!set) {
                listeners.set(channel, (set = new Set()));
                attach(channel);
            }
            set.add(listener);
            return () => {
                set.delete(listener);
            };
        },
    };
}
