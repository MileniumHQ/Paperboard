// Broadcast events: which sockets declared which event names, and delivery
// to exactly those sockets.
import { WebSocket } from "ws";
import type { EventPayload } from "@mileniumhq/paperapi/protocol";
import type { TrafficMonitor } from "./monitor";
import { sendBounded } from "./wsFrames";

// per-socket broadcast interest is opt-in: a socket that never declares an
// events:subscribe list receives no broadcast event frames at all

export class EventSubscriptions {
    // broadcast interest per socket: socket → declared event names
    private bySocket = new Map<WebSocket, Set<string>>();
    // event name → sockets that declared it. A "*" entry receives every
    // event. Broadcasting walks only the interested sockets, never the whole
    // connection set: filtering after a broad scan is not scoping.
    private byEvent = new Map<string, Set<WebSocket>>();

    constructor(private monitor: TrafficMonitor) {}

    // sends an event to the sockets that declared it; fromPanel is who raised
    // it, and `audience`, when given, the sockets it may reach at all
    deliver<E extends string>(event: E, payload: EventPayload<E>, fromPanel: string | null, audience?: (socket: WebSocket) => boolean): void {
        const recipients = new Set<WebSocket>();
        for (const client of this.byEvent.get(event) ?? []) if (!audience || audience(client)) recipients.add(client);
        for (const client of this.byEvent.get("*") ?? []) if (!audience || audience(client)) recipients.add(client);
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
    // socket wants to receive, as events:subscribe's shape read them
    // (bounded, text only). events:unsubscribe is expressed as an empty
    // list — one idempotent toggle. Returns how many it hears.
    subscribe(socket: WebSocket, events: string[]): number {
        const declared = new Set(events);
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
        return declared.size;
    }
}
