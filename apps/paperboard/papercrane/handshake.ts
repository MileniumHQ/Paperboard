import * as fs from "fs";
import * as path from "path";
import { getPaperboardDir } from "./paths";
import { logger } from "./logger";

// The crane.json handshake file: papercrane writes {port, token} on every
// listen (papercrane/index.ts writeCraneJson), 0600. EVERY main-process
// reader of this file goes through readCraneHandshake — one reader, one
// validation, no mirrors. PaperAPI's panels-side reader (ws.ts) re-validates
// at its own trust boundary; the strictness here is the app-side source of
// truth both Electron surfaces share.

export interface CraneHandshakeFile {
    port: number;
    token: string;
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
        return { port: creds.port, token: creds.token };
    } catch (err) {
        // missing/unparseable handshake at startup is routine (daemon still
        // booting) — logged, callers treat null as not-ready
        logger.debug("[handshake] crane.json unreadable:", err);
        return null;
    }
}
