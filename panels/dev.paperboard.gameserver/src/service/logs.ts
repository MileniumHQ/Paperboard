import * as fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { files as fileApi, type ServiceContext } from "@paperboard-dev/paperapi";
import { listDirectory } from "../lib/filesystem";
import { isLogFileName, tailChars } from "../core/logs";
import { type GameServerState, PANEL_ID } from "./types";

// the log viewer is bounded twice: a compressed archive we will not expand,
// and a character cap on what is returned over the bridge
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_PLAIN_READ_BYTES = 4 * 1024 * 1024;
const MAX_LOG_CHARS = 400_000;

export interface LogFileInfo {
    name: string;
    size: number;
    mtimeMs: number;
}

export interface LogFileContent {
    name: string;
    content: string;
    truncated: boolean;
}

export async function listLogFiles(
    _ctx: ServiceContext<GameServerState>,
): Promise<LogFileInfo[]> {
    const entries = await listDirectory("logs");
    const files: LogFileInfo[] = [];
    for (const entry of entries) {
        if (!isLogFileName(entry)) continue;
        try {
            const absolute = await fileApi.getPath(`logs/${entry}`, PANEL_ID);
            const stat = fs.statSync(absolute);
            if (!stat.isFile()) continue;
            files.push({ name: entry, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (err) {
            console.debug(`[Service:Logs] stat failed for "${entry}":`, String(err));
        }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
}

function readTail(path: string, maxBytes: number): Buffer {
    const size = fs.statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(path, "r");
    try {
        fs.readSync(fd, buffer, 0, length, start);
    } finally {
        fs.closeSync(fd);
    }
    return buffer;
}

export async function readLogFile(
    _ctx: ServiceContext<GameServerState>,
    name: string,
): Promise<LogFileContent> {
    // boundary: the name reaches the filesystem — validated here, not in UI
    if (!isLogFileName(name)) {
        throw new Error(`Refusing to read unsafe log file name: ${JSON.stringify(name)}`);
    }
    const relative = `logs/${name}`;
    if (!(await fileApi.exists(relative, PANEL_ID))) {
        throw new Error(`Log file not found: ${name}`);
    }
    const absolute = await fileApi.getPath(relative, PANEL_ID);
    const size = fs.statSync(absolute).size;

    let raw: string;
    if (name.endsWith(".gz")) {
        if (size > MAX_COMPRESSED_BYTES) {
            throw new Error(
                `Log archive too large to open (${Math.round(size / 1024 / 1024)} MB compressed)`,
            );
        }
        // bound the DECOMPRESSED output too: a crafted archive can expand
        // far past its compressed size and exhaust the daemon
        raw = gunzipSync(fs.readFileSync(absolute), {
            maxOutputLength: MAX_DECOMPRESSED_BYTES,
        }).toString("utf8");
    } else {
        raw = readTail(absolute, MAX_PLAIN_READ_BYTES).toString("utf8");
    }

    const { text, truncated } = tailChars(raw, MAX_LOG_CHARS);
    return { name, content: text, truncated };
}
