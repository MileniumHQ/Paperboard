// The traffic tap behind `paperapi monitor`: one record per handled call,
// broadcast event and lifecycle change, sent to the sockets that subscribed.
//
// It costs nothing while nobody watches: callers check `active` before they
// build a record, and the engine's lifecycle feed is only attached while
// there is a subscriber. Only a socket holding this computer's own host
// token may subscribe (ws.ts decides that, not this file).
//
// Records never carry secret values, file contents or results. A call's
// arguments are summarised by summarizeParams: protocol identifiers by value,
// everything else by its shape.
import type { WebSocket } from "ws";
import { isPanelId } from "../../../packages/paperapi/src/panelIdentity";
import {
    MONITOR_FRAME,
    monitorRecordInvolves,
    type MonitorArg,
    type MonitorLifecycle,
    type MonitorRecord,
} from "../../../packages/paperapi/src/monitorProtocol";

// Arguments the protocol itself defines, whose values name things rather
// than carry content: which panel, which action, which process, which path.
// Anything else (a secret's value, a file's data, an action's inputs, a
// config document, a URL that may hold a token) is reported by shape only.
const SHOWN_ARGS = new Set([
    "panelId", "action", "event", "trigger", "project", "id", "name",
    "computerId", "packageName", "version", "backupId", "sourceId",
    "destinationId", "downloadId", "appId", "signal", "cols", "rows",
    "timeoutMs", "stdin", "consoleInput", "inputEncoding", "allowDowngrade",
    "deleteData", "targetPath", "path", "cwd", "command",
]);
// transport fields every SDK call carries; the token is a credential
const HIDDEN_ARGS = new Set(["token", "v"]);
const MAX_SHOWN_STRING = 256;
const MAX_ARGS = 32;
const MAX_KEYS = 16;
const MAX_ERROR = 500;
const MAX_METHOD = 128;

function shapeOf(value: unknown): MonitorArg {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return { type: "string", size: value.length };
    if (typeof value === "number") return { type: "number" };
    if (typeof value === "boolean") return { type: "boolean" };
    if (Array.isArray(value)) return { type: "array", size: value.length };
    if (typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, MAX_KEYS) };
    return { type: "string", size: String(value).length };
}

/** What a monitor may show of a call's parameters. */
export function summarizeParams(params: unknown): Record<string, MonitorArg> {
    const out: Record<string, MonitorArg> = {};
    if (!params || typeof params !== "object" || Array.isArray(params)) return out;
    let count = 0;
    for (const [key, value] of Object.entries(params)) {
        if (HIDDEN_ARGS.has(key) || value === undefined) continue;
        if (count++ >= MAX_ARGS) break;
        const shown = SHOWN_ARGS.has(key) && (
            typeof value === "number" || typeof value === "boolean" || value === null ||
            (typeof value === "string" && value.length <= MAX_SHOWN_STRING)
        );
        out[key] = shown ? (value as MonitorArg) : shapeOf(value);
    }
    return out;
}

export interface RpcTap {
    panel: string | null;
    method: unknown;
    params: unknown;
    /** Date.now() when the request arrived */
    at: number;
    /** performance.now() when the request arrived */
    started: number;
    error?: string;
    code?: string;
}

type Send = (socket: WebSocket, payload: string) => boolean;
type Lifecycle = (listener: (change: MonitorLifecycle) => void) => () => void;

export class TrafficMonitor {
    // subscriber → the panel it watches, or null for everything
    private subscribers = new Map<WebSocket, string | null>();
    private detachLifecycle: (() => void) | null = null;

    constructor(private lifecycle: Lifecycle, private send: Send) {}

    get active(): boolean {
        return this.subscribers.size > 0;
    }

    subscribe(socket: WebSocket, panelId: string | null): void {
        this.subscribers.set(socket, panelId);
        if (!this.detachLifecycle) {
            this.detachLifecycle = this.lifecycle((change) => this.publish({ ...change, at: Date.now() } as MonitorRecord));
        }
    }

    unsubscribe(socket: WebSocket): void {
        if (!this.subscribers.delete(socket) || this.subscribers.size > 0) return;
        this.detachLifecycle?.();
        this.detachLifecycle = null;
    }

    clear(): void {
        this.subscribers.clear();
        this.detachLifecycle?.();
        this.detachLifecycle = null;
    }

    rpc(call: RpcTap): void {
        if (!this.active) return;
        const params = call.params as { panelId?: unknown } | null | undefined;
        const target = params && typeof params === "object" && isPanelId(params.panelId) ? params.panelId : undefined;
        this.publish({
            type: "rpc",
            at: call.at,
            panel: call.panel,
            method: typeof call.method === "string" ? call.method.slice(0, MAX_METHOD) : "(no action)",
            ...(target ? { target } : {}),
            ms: Math.round((performance.now() - call.started) * 10) / 10,
            ok: call.error === undefined,
            ...(call.error !== undefined ? { error: call.error.slice(0, MAX_ERROR) } : {}),
            ...(call.code ? { code: call.code } : {}),
            args: summarizeParams(call.params),
        });
    }

    event(panel: string | null, event: string, frame: string, recipients: number): void {
        if (!this.active) return;
        this.publish({
            type: "event",
            at: Date.now(),
            panel,
            event: event.slice(0, MAX_METHOD * 2),
            bytes: Buffer.byteLength(frame),
            recipients,
        });
    }

    private publish(record: MonitorRecord): void {
        const frame = JSON.stringify({ type: MONITOR_FRAME, record });
        for (const [socket, panelId] of this.subscribers) {
            if (panelId !== null && !monitorRecordInvolves(record, panelId)) continue;
            // a watcher that cannot keep up is told so, never fed a feed
            // with silent holes in it
            if (!this.send(socket, frame)) {
                this.unsubscribe(socket);
                socket.close(4429, "Slow monitor consumer");
            }
        }
    }
}
