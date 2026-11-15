import { EventEmitter } from "node:events";
import * as path from "node:path";
import { valid, gt } from "semver";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";

const MAX_TEXT_BYTES = 64 * 1024;

type UpdateInfo = ReturnType<typeof parseUpdateInfo>;

/** A small text file (the update feed, SHA256SUMS), read up to 64 KiB: a
 * larger answer stops at the cap instead of filling memory. */
export async function readCappedText(url: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not check app updates: ${url} answered HTTP ${response.status}`);
    if (!response.body) throw new Error(`Could not check app updates: ${url} answered nothing`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_TEXT_BYTES) throw new Error(`Could not check app updates: ${url} is larger than 64 KiB`);
            chunks.push(value);
        }
    } finally {
        try { await reader.cancel(); }
        finally { reader.releaseLock(); }
    }
    return Buffer.concat(chunks).toString("utf8");
}

/** The release latest-linux.yml names, and whether it is newer than this one. */
export async function readUpdateFeed(feedUrl: string, currentVersion: string, signal: AbortSignal): Promise<{ info: UpdateInfo; newer: boolean }> {
    const info = parseUpdateInfo(await readCappedText(feedUrl, signal), path.basename(new URL(feedUrl).pathname), new URL(feedUrl));
    if (!valid(info.version) || !valid(currentVersion)) throw new Error("The app update version is invalid");
    return { info, newer: gt(info.version, currentVersion) };
}

// Availability only. A package manager owns these app bytes; we never
// download an AppImage or invoke a privileged package command to replace them.
export class ManualAppUpdater extends EventEmitter {
    private request: AbortController | null = null;
    constructor(private currentVersion: string, private feedUrl: string) { super(); }

    async checkForUpdates(): Promise<{}> {
        const controller = new AbortController();
        this.request = controller;
        try {
            const { info, newer } = await readUpdateFeed(this.feedUrl, this.currentVersion, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
            this.emit(newer ? "update-available" : "update-not-available", info);
            return {};
        } finally {
            if (this.request === controller) this.request = null;
        }
    }

    cancel(): void { this.request?.abort(); }
}
