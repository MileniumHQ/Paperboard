// The WebSocket a transport speaks through: the runtime's own where there is
// one (a page, Bun), adapted to the ws package's event shape, or the ws
// package in Node. A socket that must send headers (the local daemon's
// challenge) always uses the ws package, since a native WebSocket can't.
import { debugErr } from "../debug";

/** The ws-package shape both implementations offer. */
export interface TransportSocket {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on(event: string, cb: (arg?: any) => void): void;
    off(event: string, cb?: (arg?: any) => void): void;
}

export type SocketConstructor = new (url: string, options?: { headers?: Record<string, string> }) => TransportSocket;

// @vite-ignore keeps node builtins out of browser builds
export async function nodeBuiltin(name: string): Promise<any> {
    return import(/* @vite-ignore */ `node:${name}`);
}

export async function webSocketImpl(withHeaders = false): Promise<SocketConstructor> {
    const g = globalThis as any;
    if (!withHeaders && typeof g.WebSocket !== "undefined") {
        // Adapt native events to the ws-package shape
        return class NativeAdapter {
            private _ws: WebSocket;
            private _url: string;
            private _wrapped = new Map<(arg?: any) => void, { event: string; fn: EventListener }>();
            constructor(url: string) {
                this._url = url;
                this._ws = new g.WebSocket(url);
            }
            get readyState() {
                return this._ws.readyState;
            }
            send(data: string) {
                this._ws.send(data);
            }
            close() {
                // Detach every adapted listener so reconnects don't leak.
                const remove = (this._ws as any).removeEventListener?.bind(this._ws);
                if (remove) {
                    for (const { event, fn } of this._wrapped.values()) {
                        try {
                            remove(event, fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                    }
                }
                this._wrapped.clear();
                this._ws.close();
            }
            on(event: string, cb: (arg?: any) => void) {
                // a native error event carries no reason; the ws package
                // hands its listeners an Error, so this one does too
                const wrapped: EventListener =
                    event === "message"
                        ? (e) => cb((e as MessageEvent).data)
                        : event === "error"
                          ? () => cb(new Error(`Couldn't reach PaperCrane at ${this._url}`))
                          : () => cb();
                this._wrapped.set(cb, { event, fn: wrapped });
                this._ws.addEventListener(event, wrapped);
            }
            off(event: string, cb?: (arg?: any) => void) {
                const remove = (this._ws as any).removeEventListener?.bind(this._ws);
                if (!remove) {
                    if (cb) this._wrapped.delete(cb);
                    else {
                        for (const [orig, entry] of this._wrapped) {
                            if (entry.event === event) this._wrapped.delete(orig);
                        }
                    }
                    return;
                }
                if (cb) {
                    const entry = this._wrapped.get(cb);
                    if (entry && entry.event === event) {
                        try {
                            remove(event, entry.fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                        this._wrapped.delete(cb);
                    }
                    return;
                }
                for (const [orig, entry] of this._wrapped) {
                    if (entry.event === event) {
                        try {
                            remove(event, entry.fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                        this._wrapped.delete(orig);
                    }
                }
            }
        };
    }
    const mod = await import(/* @vite-ignore */ "ws");
    return mod.default ?? mod.WebSocket ?? mod;
}
