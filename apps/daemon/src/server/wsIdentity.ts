// Who each socket is: the pre-auth admission budget, the identity a
// socket was granted, and the indexes that close every socket of a revoked
// credential or panel.
import type { WebSocket } from "ws";
import type { PaperCraneAuth, AuthorizedToken } from "../security/auth";
import { isLoopbackHost } from "../system/discovery";

// pre-auth slots: this machine's own callers (shell, panel services) get a
// budget no network peer can spend, and one network address cannot hold
// every remote slot
const MAX_UNAUTHENTICATED = 128;
const MAX_UNAUTHENTICATED_PER_ADDRESS = 16;

type SocketIndex = Map<string, Set<WebSocket>>;

function indexSocket(index: SocketIndex, key: string | null, ws: WebSocket): void {
    if (!key) return;
    const sockets = index.get(key) ?? new Set<WebSocket>();
    sockets.add(ws);
    index.set(key, sockets);
}

function unindexSocket(index: SocketIndex, key: string | null, ws: WebSocket): void {
    if (!key) return;
    const sockets = index.get(key);
    sockets?.delete(ws);
    if (!sockets?.size) index.delete(key);
}

export class SocketIdentities {
    readonly byToken: SocketIndex = new Map();
    readonly byPanel: SocketIndex = new Map();
    private preAuth = { loopback: 0, remote: 0, byAddress: new Map<string, number>() };

    // a release function for an admitted pre-auth socket, or null when its
    // budget is spent; release is idempotent
    admitPreAuth(address: string): (() => void) | null {
        const preAuth = this.preAuth;
        if (isLoopbackHost(address)) {
            if (preAuth.loopback >= MAX_UNAUTHENTICATED) return null;
            preAuth.loopback++;
            let held = true;
            return () => {
                if (held) preAuth.loopback--;
                held = false;
            };
        }
        const fromAddress = preAuth.byAddress.get(address) ?? 0;
        if (preAuth.remote >= MAX_UNAUTHENTICATED || fromAddress >= MAX_UNAUTHENTICATED_PER_ADDRESS) return null;
        preAuth.remote++;
        preAuth.byAddress.set(address, fromAddress + 1);
        let held = true;
        return () => {
            if (!held) return;
            held = false;
            preAuth.remote--;
            const left = (preAuth.byAddress.get(address) ?? 1) - 1;
            if (left > 0) preAuth.byAddress.set(address, left);
            else preAuth.byAddress.delete(address);
        };
    }

    /** closes every socket of a revoked credential or panel; returns the unsubscribe */
    watchRevocations(auth: PaperCraneAuth, revoke: (sockets?: Set<WebSocket>) => void): () => void {
        const onRevoked = (entry: AuthorizedToken) => revoke(this.byToken.get(entry.token));
        const onPanelRevoked = (panelId: string) => revoke(this.byPanel.get(panelId));
        auth.on("revoked", onRevoked);
        auth.on("panel-revoked", onPanelRevoked);
        return () => {
            auth.off("revoked", onRevoked);
            auth.off("panel-revoked", onPanelRevoked);
        };
    }

    clear(): void {
        this.byToken.clear();
        this.byPanel.clear();
    }
}

/** One socket's identity. Granted by a credential, never a caller parameter. */
export class SocketIdentity {
    authenticated: boolean;
    // token for this socket, revoke-self only revokes this one
    token: string | null = null;
    // granted panel identity for this socket (token claim, never a caller
    // parameter). Null = full-authority master/host caller.
    panelId: string | null = null;
    // relay-only socket (remote-served panel): may tunnel to this one
    // computer and nothing else. Null = an ordinary principal.
    relayTo: string | null = null;

    constructor(
        private ws: WebSocket,
        private identities: SocketIdentities,
        authenticated: boolean,
        private onGranted: () => void,
    ) {
        this.authenticated = authenticated;
    }

    grant(token: string | null, panelId: string | null, relayTo: string | null = null): void {
        this.unindex();
        this.token = token;
        this.panelId = panelId;
        this.relayTo = relayTo;
        this.authenticated = true;
        indexSocket(this.identities.byToken, token, this.ws);
        indexSocket(this.identities.byPanel, panelId, this.ws);
        this.onGranted();
    }

    /** out of the token index, so revoking its own token does not close it first */
    unindexToken(): void {
        unindexSocket(this.identities.byToken, this.token, this.ws);
    }

    reindexToken(): void {
        indexSocket(this.identities.byToken, this.token, this.ws);
    }

    unindex(): void {
        unindexSocket(this.identities.byToken, this.token, this.ws);
        unindexSocket(this.identities.byPanel, this.panelId, this.ws);
    }
}
