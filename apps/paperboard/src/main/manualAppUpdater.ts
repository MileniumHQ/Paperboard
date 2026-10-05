import { EventEmitter } from "node:events";
import { valid, gt } from "semver";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";

const MAX_FEED_BYTES = 64 * 1024;

// Availability only. A package manager owns these app bytes; we never
// download an AppImage or invoke a privileged package command to replace them.
export class ManualAppUpdater extends EventEmitter {
    private request: AbortController | null = null;
    constructor(private currentVersion: string, private feedUrl: string) { super(); }

    async checkForUpdates(): Promise<{}> {
        const controller = new AbortController();
        this.request = controller;
        try {
            const response = await fetch(this.feedUrl, {
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            });
            if (!response.ok) throw new Error(`Could not check app updates: HTTP ${response.status}`);
            if (!response.body) throw new Error("The app update feed is empty");
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    bytes += value.byteLength;
                    if (bytes > MAX_FEED_BYTES) throw new Error("The app update feed exceeds 64 KiB");
                    chunks.push(value);
                }
            } finally {
                try { await reader.cancel(); }
                finally { reader.releaseLock(); }
            }
            const info = parseUpdateInfo(Buffer.concat(chunks).toString("utf8"), "latest-linux.yml", new URL(this.feedUrl));
            if (!valid(info.version) || !valid(this.currentVersion)) throw new Error("The app update version is invalid");
            this.emit(gt(info.version, this.currentVersion) ? "update-available" : "update-not-available", info);
            return {};
        } finally {
            controller.abort();
            if (this.request === controller) this.request = null;
        }
    }

    cancel(): void { this.request?.abort(); }
}
