// paired-computer registry for remote tunneling
import { readStateFileSync } from "./storage";

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
    // trust-relevant state (a pairing holds a pinned certificate) is never
    // read as "no paired computers": the shared state reader quarantines
    // unparseable bytes beside the file and refuses unreadable files, so
    // dropped pairings are loud and recoverable, never silent.
    const raw = readStateFileSync<{ computers?: unknown[] }>(file, {}, "paired_computers");
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
