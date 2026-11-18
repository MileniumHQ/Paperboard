// The WebSocket a transport speaks through: the runtime's own where there is
// one (a page, Bun), adapted to the ws package's event shape, or the ws
// package in Node. A socket that must send headers (the local daemon's
// challenge) always uses the ws package, since a native WebSocket can't.

/** What a socket tells its listeners, as the ws package names it. */
export interface SocketEvents {
    open: () => void;
    /** the close code and the reason the other end gave, as the ws package passes them */
    close: (code: number, reason: string) => void;
    error: (err: Error) => void;
    // a frame: text from a native socket, a Buffer from the ws package
    message: (data: unknown) => void;
}

/** The ws-package shape both implementations offer. */
export interface TransportSocket {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on<E extends keyof SocketEvents>(event: E, cb: SocketEvents[E]): void;
}

export type SocketConstructor = new (url: string, options?: { headers?: Record<string, string> }) => TransportSocket;

interface NodeBuiltins {
    async_hooks: typeof import("node:async_hooks");
    crypto: typeof import("node:crypto");
    fs: typeof import("node:fs");
    os: typeof import("node:os");
    path: typeof import("node:path");
}

// @vite-ignore keeps node builtins out of browser builds
export async function nodeBuiltin<N extends keyof NodeBuiltins>(name: N): Promise<NodeBuiltins[N]> {
    return import(/* @vite-ignore */ `node:${name}`);
}

// each native event as the ws package's listener hears it
const adapt: { [E in keyof SocketEvents]: (cb: SocketEvents[E], url: string) => EventListener } = {
    open: (cb) => () => cb(),
    close: (cb) => (e) => cb((e as CloseEvent).code, (e as CloseEvent).reason),
    // a native error event carries no reason; the ws package hands its
    // listeners an Error, so this one does too
    error: (cb, url) => () => cb(new Error(`Couldn't reach PaperCrane at ${url}`)),
    message: (cb) => (e) => cb(e instanceof MessageEvent ? e.data : undefined),
};

export async function webSocketImpl(withHeaders = false): Promise<SocketConstructor> {
    if (!withHeaders && typeof globalThis.WebSocket !== "undefined") {
        // Adapt native events to the ws-package shape
        return class NativeAdapter implements TransportSocket {
            private _ws: WebSocket;
            private _url: string;
            private _wrapped: { event: string; fn: EventListener }[] = [];
            constructor(url: string) {
                this._url = url;
                this._ws = new WebSocket(url);
            }
            get readyState() {
                return this._ws.readyState;
            }
            send(data: string) {
                this._ws.send(data);
            }
            close() {
                // Detach every adapted listener so reconnects don't leak.
                for (const { event, fn } of this._wrapped) this._ws.removeEventListener(event, fn);
                this._wrapped = [];
                this._ws.close();
            }
            on<E extends keyof SocketEvents>(event: E, cb: SocketEvents[E]) {
                const fn = adapt[event](cb, this._url);
                this._wrapped.push({ event, fn });
                this._ws.addEventListener(event, fn);
            }
        };
    }
    const mod = await import(/* @vite-ignore */ "ws");
    return mod.default ?? mod.WebSocket ?? mod;
}
