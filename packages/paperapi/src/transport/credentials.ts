// Where a transport finds its daemon and the credential it signs in with.
// Granted credentials always win over discovered ones, in this order:
// explicit options, the host's provider, a service's boot context, a page's
// injected credentials, and last the local handshake file for a Node script
// the daemon did not start, whose listener must prove itself first.
import type * as cryptoType from "crypto";
import type * as fsType from "fs";
import type * as pathType from "path";
import type * as osType from "os";

import { serviceBootContext, serviceBootRefusal } from "../boot";
import { challengeDaemon, handshakeFileIn, paperboardDirIn, readHandshake, type DaemonChallenge } from "./localHandshake";
import { nodeBuiltin } from "./socket";

/** How a host says where its daemon is: the loopback port it listens on, or
 * the ws(s):// URL of a daemon it reaches some other way. */
export type CraneCredentials = { token: string } & ({ port: number; url?: undefined } | { url: string; port?: undefined });

export function craneEndpoint(creds: { port?: unknown; url?: unknown }): string {
    if (typeof creds.url === "string") {
        let url: URL;
        try {
            url = new URL(creds.url);
        } catch {
            throw new Error(`The Paperboard host gave a daemon address that isn't a URL: ${creds.url}`);
        }
        if (url.protocol !== "wss:" && url.protocol !== "ws:") {
            throw new Error(`The Paperboard host gave a daemon address that isn't a WebSocket URL: ${creds.url}`);
        }
        return url.href;
    }
    if (typeof creds.port === "number" && Number.isInteger(creds.port) && creds.port > 0 && creds.port < 65536) {
        return `ws://127.0.0.1:${creds.port}`;
    }
    throw new Error("The Paperboard host gave neither a daemon port nor a daemon URL");
}

export interface ResolvedCredentials {
    endpoint: string;
    token: string;
    /** Set when the listener must prove it holds the token before the token is sent. */
    challenge?: DaemonChallenge;
}

export interface CredentialSources {
    port?: number;
    token?: string;
    computerId: string;
    isNode: boolean;
    provider: (() => Promise<CraneCredentials>) | null;
    /** Node-only: explicit handshake file instead of the default location. */
    craneJsonPath?: string;
}

export async function resolveCredentials(sources: CredentialSources): Promise<ResolvedCredentials> {
    if (sources.port && sources.token) {
        return { endpoint: craneEndpoint({ port: sources.port }), token: sources.token };
    }

    if (sources.provider) {
        const creds = await sources.provider();
        return { endpoint: craneEndpoint(creds), token: creds.token };
    }

    // service boot context: credentials GRANTED at service start
    // (in-process boot window or spawned-service env, captured once in
    // boot.ts). A service never reads crane.json or ambient env to find out
    // who it is, so one booted without a usable context fails here.
    const boot = serviceBootContext();
    if (boot) return { endpoint: craneEndpoint(boot), token: boot.token };
    const refused = serviceBootRefusal();
    if (refused) throw new Error(refused);

    if (!sources.isNode) {
        // Browser: credentials are injected by the host at serve time
        // (scoped to this document's computer). No fetch fallback.
        const injected = (globalThis as any).__PAPERBOARD_CRANE;
        if (!(injected?.port || injected?.url) || !injected?.token) {
            throw new Error("Paperboard host unavailable (no injected crane credentials)");
        }
        if (injected.computerId !== sources.computerId) {
            throw new Error(
                `Paperboard host served credentials for "${injected.computerId}" but this panel is scoped to "${sources.computerId}"`,
            );
        }
        return { endpoint: craneEndpoint(injected), token: injected.token };
    }

    // Node reads the local handshake file; always local-scoped
    if (sources.computerId !== "local") {
        throw new Error(
            `Transport scoped to "${sources.computerId}" requires explicit port/token credentials in Node`,
        );
    }
    const pathMod: typeof pathType = await nodeBuiltin("path");
    const osMod: typeof osType = await nodeBuiltin("os");
    const fsMod: typeof fsType = await nodeBuiltin("fs");
    const cryptoMod: typeof cryptoType = await nodeBuiltin("crypto");
    const file = sources.craneJsonPath || handshakeFileIn(paperboardDirIn(osMod.homedir(), pathMod.join), pathMod.join);
    const handshake = readHandshake(fsMod, file);
    return {
        endpoint: craneEndpoint({ port: handshake.port }),
        token: handshake.token,
        challenge: challengeDaemon(cryptoMod, handshake),
    };
}
