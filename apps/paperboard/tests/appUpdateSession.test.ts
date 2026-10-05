import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { AppUpdateSession } from "../src/main/appUpdateSession";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class Updater extends EventEmitter {
    checks = 0;
    result = deferred<{ downloadPromise?: Promise<unknown>; cancellationToken?: { cancel(): void } } | null>();
    checkForUpdates() { this.checks++; return this.result.promise; }
}

describe("desktop app update completion and hydration", () => {
    it("waits for download completion and keeps ready state for a later window", async () => {
        const updater = new Updater();
        const download = deferred<unknown>();
        const session = new AppUpdateSession(updater, () => undefined);
        try {
            let completed = false;
            const run = session.check().then((state) => { completed = true; return state; });
            expect(session.check()).not.toBeNull();
            expect(updater.checks).toBe(1);
            updater.emit("update-available", { version: "0.2.0" });
            updater.result.resolve({ downloadPromise: download.promise });
            await Promise.resolve();
            expect(completed).toBe(false);
            expect(session.snapshot().status).toBe("downloading");
            updater.emit("update-downloaded", { version: "0.2.0" });
            download.resolve([]);
            expect((await run).status).toBe("ready");
            expect(session.snapshot()).toMatchObject({ status: "ready", version: "0.2.0", percent: 100 });
        } finally { session.dispose(); }
    });

    it("retains a failed download and its available version even without an error event", async () => {
        const updater = new Updater();
        const download = deferred<unknown>();
        const session = new AppUpdateSession(updater, () => undefined);
        try {
            const run = session.check();
            updater.emit("update-available", { version: "0.2.0" });
            updater.result.resolve({ downloadPromise: download.promise });
            download.reject(new Error("SHA512 checksum mismatch"));
            expect(await run).toMatchObject({ status: "failed", version: "0.2.0", error: "SHA512 checksum mismatch" });
            const snapshot = session.snapshot();
            snapshot.status = "current";
            expect(session.snapshot().status).toBe("failed");
        } finally { session.dispose(); }
    });

    it("an unavailable updater is failure, not up to date", async () => {
        const updater = new Updater();
        const session = new AppUpdateSession(updater, () => undefined);
        try {
            const run = session.check();
            updater.result.resolve(null);
            expect((await run).status).toBe("failed");
        } finally { session.dispose(); }
    });

    it("native activation failure stays failed when macOS subsequently emits downloaded", async () => {
        const updater = new Updater();
        const download = deferred<unknown>();
        const session = new AppUpdateSession(updater, () => undefined);
        try {
            const run = session.check();
            updater.emit("update-available", { version: "0.2.0" });
            updater.result.resolve({ downloadPromise: download.promise });
            updater.emit("error", new Error("Could not get code signature for running application"));
            updater.emit("update-downloaded", { version: "0.2.0" });
            download.resolve([]);
            expect(await run).toMatchObject({ status: "failed", version: "0.2.0", error: "Could not get code signature for running application" });
        } finally { session.dispose(); }
    });

    it("cancels a timed-out download and ignores late success", async () => {
        const updater = new Updater();
        const download = deferred<unknown>();
        let cancelled = false;
        const session = new AppUpdateSession(updater, () => undefined, 10);
        try {
            const run = session.check();
            updater.result.resolve({ downloadPromise: download.promise, cancellationToken: { cancel: () => { cancelled = true; } } });
            expect((await run).status).toBe("failed");
            expect(cancelled).toBe(true);
            updater.emit("update-downloaded", { version: "0.2.0" });
            download.resolve([]);
            expect(session.snapshot().status).toBe("failed");
            await session.check();
            expect(updater.checks).toBe(1);
        } finally { session.dispose(); }
    });

    it("tears down pending work and only its own event listeners", async () => {
        const updater = new Updater();
        const otherListener = () => undefined;
        updater.on("update-downloaded", otherListener);
        const session = new AppUpdateSession(updater, () => undefined);
        const run = session.check();
        session.dispose();
        await run;
        expect(updater.listeners("update-downloaded")).toEqual([otherListener]);
        expect(updater.listenerCount("download-progress")).toBe(0);
        updater.result.resolve(null);
    });
});
