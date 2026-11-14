// The attachment ledger: which terminals and processes a transport is
// attached to, shared by every stream subscription that reads them.
import type { CraneTransport } from "./ws";
import { debugErr } from "./debug";

// Subscribers to one resource share ONE attachment (one attach RPC, one
// reconnect replay entry); the last one to leave tears it down. The
// resource is tracked for reconnect replay from the start, so an attach the
// socket dropped is sent again, and untracked once the daemon answers that
// nothing has that id or refuses it: like process-attach, only a resource
// that is there is replayed. Keyed per transport: transports are per-scope
// and replaceable, and a WeakMap entry dies with its transport.
export type Resource = "terminal" | "process";
interface Attachment {
    count: number;
    attached: Promise<boolean>;
}
const attachRefs = new WeakMap<CraneTransport, Map<string, Attachment>>();

function ledgerFor(t: CraneTransport): Map<string, Attachment> {
    let ledger = attachRefs.get(t);
    if (!ledger) {
        ledger = new Map();
        attachRefs.set(t, ledger);
    }
    return ledger;
}

export function attachShared(tracked: Resource, id: string, t: CraneTransport): Promise<boolean> {
    const ledger = ledgerFor(t);
    const key = `${tracked}:${id}`;
    const live = ledger.get(key);
    if (live) {
        live.count++;
        return live.attached;
    }
    const action = tracked === "terminal" ? "term:attach" : "process:attach";
    const track = (on: boolean) => {
        if (tracked === "terminal") on ? t.trackTerminal(id) : t.untrackTerminal(id);
        else on ? t.trackProcess(id) : t.untrackProcess(id);
    };
    track(true);
    // a subscriber that left before the answer took the entry with it
    const current = () => ledger.get(key) === entry;
    const entry: Attachment = {
        count: 1,
        attached: t.call(action, { id }).then(
            (res: { success?: boolean } | undefined) => {
                const success = res?.success === true;
                if (!success && current()) track(false);
                return success;
            },
            (err) => {
                // a lost connection keeps the id: the reconnect sends it again
                if (current() && t.isConnected()) track(false);
                throw err;
            },
        ),
    };
    // logged here as well, for the subscriber that never reads `attached`
    entry.attached.catch((err) => debugErr(`${action} ${id}`, err));
    ledger.set(key, entry);
    return entry.attached;
}

export function releaseAttachment(tracked: Resource, id: string, t: CraneTransport): void {
    const ledger = ledgerFor(t);
    const key = `${tracked}:${id}`;
    const entry = ledger.get(key);
    if (entry && entry.count > 1) {
        entry.count--;
        return;
    }
    ledger.delete(key);
    if (tracked === "terminal") t.untrackTerminal(id);
    else t.untrackProcess(id);
}

// a destroyed/killed resource tears its ledger entry down so a later
// resubscribe attaches fresh instead of inheriting a stale count
export function dropAttachmentLedger(tracked: Resource, id: string, t: CraneTransport): void {
    ledgerFor(t).delete(`${tracked}:${id}`);
}
