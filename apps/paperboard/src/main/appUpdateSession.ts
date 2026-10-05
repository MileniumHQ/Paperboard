import type { AppUpdateState } from "../shared/appUpdate";
import { initialAppUpdateState } from "../shared/appUpdate";

interface AppUpdater {
    on(event: string, listener: (...args: any[]) => void): unknown;
    removeListener(event: string, listener: (...args: any[]) => void): unknown;
    checkForUpdates(): Promise<{
        downloadPromise?: Promise<unknown> | null;
        cancellationToken?: { cancel(): void };
    } | null>;
    cancel?(): void;
}

// The main process owns the snapshot. A new window hydrates it instead of
// depending on a download/error event that may have preceded that window.
export class AppUpdateSession {
    private state: AppUpdateState = { ...initialAppUpdateState };
    private running: Promise<AppUpdateState> | null = null;
    private disposed = false;
    private cancelDownload: (() => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private rejectRun: ((error: Error) => void) | null = null;
    private expired = false;
    private failedRun = false;
    private listeners: [string, (...args: any[]) => void][];

    constructor(
        private updater: AppUpdater,
        private publish: (state: AppUpdateState) => void,
        private timeoutMs = 10 * 60_000,
        installMode: AppUpdateState["installMode"] = "automatic",
    ) {
        this.state.installMode = installMode;
        this.listeners = [
            ["update-available", (info) => this.set({ status: installMode === "package-manager" ? "manual" : "downloading", version: info.version, percent: null, error: null })],
            ["update-not-available", () => this.set({ status: "current", version: null, percent: null, error: null })],
            ["download-progress", (progress) => this.set({ percent: Math.round(progress.percent) })],
            ["update-downloaded", (info) => this.set({ status: "ready", version: info.version, percent: 100, error: null })],
            ["error", (err) => this.fail(err)],
        ];
        for (const [event, listener] of this.listeners) updater.on(event, listener);
    }

    snapshot(): AppUpdateState { return { ...this.state }; }

    private set(change: Partial<AppUpdateState>) {
        if (this.disposed || this.expired) return;
        if (this.failedRun && change.status !== "failed") return;
        this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
        this.publish(this.snapshot());
    }

    private fail(err: unknown) {
        this.failedRun = true;
        this.set({ status: "failed", percent: null, error: err instanceof Error ? err.message : String(err) });
    }

    check(): Promise<AppUpdateState> {
        if (this.disposed) return Promise.reject(new Error("App updater has stopped"));
        if (this.running) return this.running;
        if (this.expired) return Promise.resolve(this.snapshot());
        this.failedRun = false;
        this.set({ status: "checking", percent: null, error: null });
        this.running = this.run().finally(() => { this.running = null; });
        return this.running;
    }

    private async run(): Promise<AppUpdateState> {
        let timedOut = false;
        const work = (async () => {
            const result = await this.updater.checkForUpdates();
            this.cancelDownload = result?.cancellationToken ? () => result.cancellationToken!.cancel() : null;
            if (timedOut || this.disposed) this.cancelDownload?.();
            if (result === null) throw new Error("Automatic updates are unavailable for this installation. Download the latest Paperboard installer.");
            await result.downloadPromise;
        })();
        try {
            await Promise.race([work, new Promise<never>((_, reject) => {
                this.rejectRun = reject;
                this.timer = setTimeout(() => {
                    timedOut = true;
                    this.updater.cancel?.();
                    this.cancelDownload?.();
                    reject(new Error("The app update timed out. Check your connection and try again."));
                }, this.timeoutMs);
            })]);
        } catch (err) {
            this.fail(err);
            // A timed-out metadata request may still emit late events. It
            // cannot turn this run green or start another run in this process.
            this.expired = timedOut;
        } finally {
            clearTimeout(this.timer);
            this.timer = undefined;
            this.rejectRun = null;
            this.cancelDownload = null;
        }
        return this.snapshot();
    }

    dispose() {
        this.disposed = true;
        this.updater.cancel?.();
        clearTimeout(this.timer);
        this.rejectRun?.(new Error("App updater has stopped"));
        this.cancelDownload?.();
        for (const [event, listener] of this.listeners) this.updater.removeListener(event, listener);
    }
}

let appUpdateState: AppUpdateState = { ...initialAppUpdateState };
export function getAppUpdateState(): AppUpdateState { return { ...appUpdateState }; }
export function retainAppUpdateState(state: AppUpdateState): void { appUpdateState = { ...state }; }
