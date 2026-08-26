// Paired-computer registry access for remote tunneling.
import * as fs from "fs";

export interface RemoteEntry {
    id: string;
    name?: string;
    host: string;
    port: number;
    token?: string;
    isLocal?: boolean;
}

export function readRemotes(file: string | undefined): RemoteEntry[] {
    if (!file) return [];
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const list: RemoteEntry[] = Array.isArray(raw?.computers)
            ? raw.computers
            : [];
        return list.filter((c) => c && !c.isLocal && c.host && c.port);
    } catch {
        return [];
    }
}
