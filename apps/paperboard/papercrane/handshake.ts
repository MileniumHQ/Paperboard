import * as fs from "fs";
import * as path from "path";
import { createHmac } from "node:crypto";
import { secretsMatch } from "./secretCompare";
import { getPaperboardDir } from "./paths";
import { logger } from "./logger";

// Reading crane.json validates discovery metadata, not listener identity.
// PaperCraneClient verifies the nonce proof on the same WebSocket before
// sending a credential. Consumers must use its authenticated client state.

export const DAEMON_CHALLENGE_HEADER = "x-papercrane-challenge";
export const DAEMON_PROOF_TYPE = "daemon-proof";

export function isDaemonChallenge(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function daemonProof(token: string, challenge: string): string {
    return createHmac("sha256", token).update(`papercrane-local-proof-v1\n${challenge}`).digest("hex");
}

export function verifyDaemonProof(token: string, challenge: string, proof: unknown): boolean {
    return isDaemonChallenge(challenge) && typeof proof === "string" &&
        /^[a-f0-9]{64}$/.test(proof) && secretsMatch(daemonProof(token, challenge), proof);
}

export interface CraneHandshakeFile {
    port: number;
    token: string;
    startId?: string;
}

export function craneHandshakePath(): string {
    return path.join(getPaperboardDir(), "local", "crane.json");
}

// strict read: garbage fields are refused here, never passed on as a token
// injected into panel HTML or credentials handed to a renderer
export function readCraneHandshake(): CraneHandshakeFile | null {
    try {
        const creds = JSON.parse(fs.readFileSync(craneHandshakePath(), "utf8"));
        if (
            !creds ||
            typeof creds !== "object" ||
            typeof creds.port !== "number" ||
            !Number.isFinite(creds.port) ||
            typeof creds.token !== "string" ||
            creds.token.length === 0
        ) {
            logger.debug("[handshake] crane.json has invalid port/token fields");
            return null;
        }
        return { port: creds.port, token: creds.token, ...(typeof creds.startId === "string" ? { startId: creds.startId } : {}) };
    } catch (err) {
        // missing/unparseable handshake at startup is routine (daemon still
        // booting) — logged, callers treat null as not-ready
        logger.debug("[handshake] crane.json unreadable:", err);
        return null;
    }
}

// The path is captured at startup, because an embedded host can change its
// configured data root later. A stopped generation never removes a newer
// daemon's handshake. Synchronous read/unlink cannot interleave in this host.
export function removeCraneHandshake(file: string, startId: string): void {
    try {
        const record = JSON.parse(fs.readFileSync(file, "utf8"));
        if (record?.startId === startId) fs.unlinkSync(file);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
    }
}
