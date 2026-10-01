// paired-computer registry for remote tunneling
import * as fs from "fs";
import { logger } from "./logger";

export interface RemoteEntry {
    id: string;
    name?: string;
    host: string;
    port: number;
    token?: string;
    // the remote daemon's certificate, pinned when it was paired
    cert: string;
    isLocal?: boolean;
}

export function readRemotes(file: string | undefined): RemoteEntry[] {
    if (!file) return [];
    let raw: any;
    try {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        // corrupt remotes file reads as empty (quarantine lives in
        // credentials.ts; here the file is advisory, not trust)
        logger.debug(`[remotes] unreadable remotes file ${file}, treating as empty:`, err);
        return [];
    }
    const list: unknown[] = Array.isArray(raw?.computers) ? raw.computers : [];
    return (list as RemoteEntry[]).filter(
        (c) =>
            !!c &&
            !c.isLocal &&
            typeof c.host === "string" &&
            c.host.length > 0 &&
            typeof c.port === "number" &&
            Number.isInteger(c.port) &&
            c.port > 0 &&
            c.port <= 65535 &&
            typeof c.cert === "string" &&
            c.cert.length > 0 &&
            (typeof c.id === "string" || typeof c.name === "string"),
    );
}
