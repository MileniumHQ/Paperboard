// Broadcast events: which sockets declared which event names, and delivery
// to exactly those sockets.
import { WebSocket } from "ws";
import { ErrorCode } from "./protocol";
import type { TrafficMonitor } from "./monitor";
import { sendBounded } from "./wsFrames";

// per-socket broadcast interest is opt-in: a socket that never declares an
// events:subscribe list receives no broadcast event frames at all
const MAX_EVENT_SUBS = 512;

export class EventSubscriptions {
    // broadcast interest per socket: socket → declared event names
    private bySocket = new Map<WebSocket, Set<string>>();
    // event name → sockets that declared it. A "*" entry receives every
    // event. Broadcasting walks only the interested sockets, never the whole
    // connection set: filtering after a broad scan is not scoping.
    private byEvent = new Map<string, Set<WebSocket>>();

    constructor(private monitor: TrafficMonitor) {}

    // sends an event to the sockets that declared it; fromPanel is who raised it
    deliver(event: string, payload: any, fromPanel: string | null): void {
        const recipients = new Set<WebSocket>();
        for (const client of this.byEvent.get(event) ?? []) recipients.add(client);
        for (const client of this.byEvent.get("*") ?? []) recipients.add(client);
        if (recipients.size === 0 && !this.monitor.active) return;
        const msg = JSON.stringify({ type: "event", event, payload });
        this.monitor.event(fromPanel, event, msg, recipients.size);
        for (const client of recipients) {
            if (client.readyState !== WebSocket.OPEN) continue;
            if (!sendBounded(client, msg)) client.close(4429, "Slow event consumer");
        }
    }

    /** a socket that closed or lost its credential hears nothing more */
    forget(socket: WebSocket): void {
        const names = this.bySocket.get(socket);
        if (names) {
            for (const name of names) {
                const set = this.byEvent.get(name);
                if (!set) continue;
                set.delete(socket);
                if (set.size === 0) this.byEvent.delete(name);
            }
        }
        this.bySocket.delete(socket);
    }

    clear(): void {
        this.bySocket.clear();
        this.byEvent.clear();
    }

    // broadcast interest: full-replace declaration of the event names this
    // socket wants to receive. events:unsubscribe is expressed as an empty
    // list — one idempotent toggle.
    subscribe(socket: WebSocket, params: any, reply: (result: any, error?: string, code?: string) => void): void {
        const events = params?.events;
        if (!Array.isArray(events)) {
            reply(null, "Missing required parameter: events (array)", ErrorCode.INVALID_PARAMS);
            return;
        }
        if (events.length > MAX_EVENT_SUBS) {
            reply(null, `Too many event subscriptions (max ${MAX_EVENT_SUBS})`, ErrorCode.INVALID_PARAMS);
            return;
        }
        const declared = new Set<string>();
        for (const evt of events) {
            if (typeof evt === "string") declared.add(evt);
        }
        // full-replace: drop the old interest before indexing the new
        // declaration so the event index never holds a stale membership
        this.forget(socket);
        this.bySocket.set(socket, declared);
        for (const name of declared) {
            let set = this.byEvent.get(name);
            if (!set) {
                set = new Set();
                this.byEvent.set(name, set);
            }
            set.add(socket);
        }
        reply({ success: true, count: declared.size });
    }
}
