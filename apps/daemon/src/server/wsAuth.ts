// The auth actions of an RPC socket: pairing, verifying a credential,
// narrowing to a panel, issuing panel tokens and revoking its own. Every
// other action passes the gate here first.
import * as os from "os";
import type { WebSocket } from "ws";
import type { PaperCraneAuth } from "../security/auth";
import { getDetailedOsInfo } from "../system/osInfo";
import { ErrorCode } from "../core/protocol";
import { readParams } from "@mileniumhq/paperapi/protocol";
import { requireHost } from "../security/principal";
import type { SocketIdentity } from "./wsIdentity";

export interface AuthContext {
    ws: WebSocket;
    auth: PaperCraneAuth;
    identity: SocketIdentity;
    /** the peer's address as the socket reports it */
    remoteAddress: unknown;
    reply: (result: any, error?: string, code?: string) => void;
    revokeSockets: (sockets?: Set<WebSocket>) => void;
}

async function computerFacts() {
    const osInfo = await getDetailedOsInfo();
    return {
        hostname: os.hostname().replace(/\.local$/i, ""),
        os: osInfo.os,
        osVersion: osInfo.osVersion,
        distroId: osInfo.distroId,
        distroName: osInfo.distroName,
        flavor: osInfo.flavor,
        machine: osInfo.machine,
        board: osInfo.board,
        operator: osInfo.operator,
        arch: process.arch,
    };
}

/** Answers the auth actions and refuses calls the socket may not make; true when the request was answered. */
export async function handleAuth(action: unknown, params: any, ctx: AuthContext): Promise<boolean> {
    const { auth, identity, reply } = ctx;

    // auth handshake
    if (action === "auth:pair") {
        if (identity.authenticated) {
            reply(null, "Pairing requires a new unauthenticated connection", ErrorCode.FORBIDDEN);
            return true;
        }
        const result = auth.pair(params?.code, params?.clientName, String(ctx.remoteAddress ?? "unknown"));
        if (result.success && result.token) {
            identity.grant(result.token, null);
            reply({ success: true, token: result.token, ...(await computerFacts()) });
        } else {
            reply(null, result.error || "Pairing failed");
        }
        return true;
    }

    if (action === "auth:verify") {
        const entry = auth.resolveToken(params?.token);
        const valid = auth.noAuth || entry !== null;
        if (valid) {
            if (
                identity.panelId &&
                (entry?.panelId !== identity.panelId || (entry?.relayTo ?? null) !== identity.relayTo)
            ) {
                reply(null, "A scoped connection cannot broaden or change its identity", ErrorCode.FORBIDDEN);
                return true;
            }
            identity.grant(params?.token ?? null, entry?.panelId ?? null, entry?.relayTo ?? null);
            // what the computer is goes to the host's own connection (the
            // shell keeps a paired computer's identity current with it); a
            // panel or relay credential is answered without reading it
            const host = !entry?.panelId && !entry?.relayTo;
            reply({ success: true, ...(host ? await computerFacts() : {}) });
        } else {
            reply(null, "Invalid authentication token", ErrorCode.AUTH_REQUIRED);
        }
        return true;
    }

    if (!identity.authenticated) {
        const entry = params?.token ? auth.resolveToken(params.token) : null;
        if (!params?.token || (entry === null && !auth.noAuth)) {
            reply(null, "Unauthorized. Authentication required.", ErrorCode.AUTH_REQUIRED);
            return true;
        }
        identity.grant(params.token, entry?.panelId ?? null, entry?.relayTo ?? null);
    }

    // relay sockets exist only to carry tunnels (handled before RPC); no
    // local RPC answers them
    if (identity.relayTo !== null && action !== "auth:revoke-self") {
        reply(null, `${String(action)} refused: this credential only relays to computer "${identity.relayTo}"`, ErrorCode.FORBIDDEN);
        return true;
    }

    // A paired host can narrow this connection permanently. The issuing
    // host token remains attached for live revocation.
    if (action === "auth:scope") {
        requireHost(identity.panelId, action);
        identity.grant(identity.token, readParams(action, params).panelId);
        reply({ success: true });
        return true;
    }
    if (action === "auth:panel-token") {
        requireHost(identity.panelId, action);
        const { panelId, relayTo: servedBy } = readParams(action, params);
        // relayTo names the computer that serves the panel; a panel served
        // from elsewhere gets a relay-only credential
        const relayTo = servedBy === undefined || servedBy === "local" ? null : servedBy;
        reply({
            token: relayTo
                ? auth.issueRelayToken(panelId, relayTo, identity.token ?? undefined)
                : auth.issuePanelToken(panelId, identity.token ?? undefined),
        });
        return true;
    }

    // revoke-self is socket-bound, no token parameter. Scoped relays must
    // not revoke their host's pairing credential.
    if (action === "auth:revoke-self") {
        if (identity.panelId && auth.matchToken(identity.token ?? undefined)?.panelId !== identity.panelId) {
            reply(null, "A scoped relay cannot revoke its issuing host", ErrorCode.FORBIDDEN);
            return true;
        }
        if (!identity.token) {
            reply(null, "Unauthorized. Authentication required.", ErrorCode.AUTH_REQUIRED);
            return true;
        }
        // persist before replying: a failed vault write throws to the error
        // reply and the token stays live. This socket is unindexed so the
        // revocation broadcast cannot close it before its own reply is sent.
        identity.unindexToken();
        try {
            auth.revokeToken(identity.token);
        } catch (err) {
            identity.reindexToken();
            throw err;
        }
        identity.authenticated = false;
        reply({ revoked: true });
        ctx.revokeSockets(new Set([ctx.ws]));
        return true;
    }
    return false;
}
