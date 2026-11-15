// What a computer's Paperboard Server can be asked: pairing, packages,
// panel installs, Stop and update, config, its own update and system info.
// The connection under it is PaperCraneConnection.ts.
import type { PanelManifest } from "../../../../papercrane";
import { logger } from "../../../../papercrane/logger";
import { PaperCraneConnection, type ProgressPayload } from "./PaperCraneConnection";

export { type PaperCraneClientOptions, type ProgressPayload, type RpcParams, type TargetStatus } from "./PaperCraneConnection";

export interface CraneSystemInfo {
    service?: string;
    version?: string;
    pid?: number;
    hostname: string;
    os: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
    ip?: string;
    username?: string;
}

export interface PackageInstallInfo {
    name?: string;
    version?: string;
    installedAt?: string;
}

// what a daemon answers a pairing code with
export interface PairResult {
    success: boolean;
    token: string;
    hostname: string;
    os: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
}

export const PACKAGE_DOWNLOAD_TIMEOUT_MS = 45 * 60_000;

export interface PanelInstallOptions {
    /** hold the install when the panel's processes run, instead of stopping them */
    ifUnused?: boolean;
    onProgress?: (payload: ProgressPayload) => void;
}

export type PanelInstallOutcome = { panel: PanelManifest } | { held: { processes: string[] } };

// a staged update waits for the processes still running the installed release
export interface PackageUpdateWait {
    name: string;
    version: string;
    // holds: an important or long-running process; the others can be
    // stopped for the update without asking
    blockedBy: Array<{ processId: string; owner: string | null; holds: boolean }>;
    error?: string;
}

export interface PackageDownloadOutcome {
    path: string;
    waiting?: PackageUpdateWait;
}

export class PaperCraneClient extends PaperCraneConnection {
    public async pair(code: string, clientName?: string): Promise<PairResult> {
        const res = await this.call<PairResult>("auth:pair", { code, clientName });
        if (res.token) {
            this.token = res.token;
        }
        return res;
    }

    public async getPackageIndex(): Promise<Record<string, PackageInstallInfo>> {
        const res = await this.call<{
            index: Record<string, PackageInstallInfo>;
        }>("package:getIndex");
        if (!res?.index || typeof res.index !== "object") throw new Error("Daemon returned no package index");
        return res.index;
    }


    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: (payload: ProgressPayload) => void,
        expectedSha256?: string,
    ): Promise<PackageDownloadOutcome> {
        return this.withProgressId(downloadId, onProgress, async () => {
            // the daemon bounds the download itself (30 min lifetime, 45 s
            // idle) and then extracts; the RPC outlives both, never the 30 s
            // default a 1.4 GB runtime cannot meet
            const res = await this.call<PackageDownloadOutcome>(
                "package:download",
                { packageName, downloadId, sha256: expectedSha256 },
                PACKAGE_DOWNLOAD_TIMEOUT_MS,
            );
            return res.waiting ? { path: res.path, waiting: res.waiting } : { path: res.path };
        });
    }

    /** Runtime package updates staged on this computer and not installed yet. */
    public async pendingPackageUpdates(): Promise<PackageUpdateWait[]> {
        const res = await this.call<{ updates?: PackageUpdateWait[] }>("package:pending");
        if (!Array.isArray(res?.updates)) throw new Error("Daemon returned no package update list");
        return res.updates;
    }

    public async listPanels(): Promise<PanelManifest[]> {
        const res = await this.call<{ panels?: PanelManifest[] }>("panel:list");
        if (!Array.isArray(res?.panels)) throw new Error("Daemon returned no panel list");
        return res.panels;
    }

    /** Running panel services on this computer, for the shell tray summary. */
    public async runningServiceCount(): Promise<number> {
        const res = await this.call<{ running: number }>("service:count", {}, 5000);
        if (!Number.isSafeInteger(res?.running) || res.running < 0) {
            throw new Error("Daemon returned an invalid running panel count");
        }
        return res.running;
    }

    /**
     * Installs the registry's release of a panel. With ifUnused, a panel
     * whose processes run is not installed: the result is held, with them.
     */
    public async installPanel(
        panelId: string,
        expected: { version?: string; sha256?: string },
        options: PanelInstallOptions = {},
    ): Promise<PanelInstallOutcome> {
        return this.withProgress(options, async (downloadId) => {
            const res = await this.call<{ panel?: PanelManifest; held?: { processes?: string[] } }>("panel:install", {
                panelId,
                version: expected.version,
                sha256: expected.sha256,
                ...(options.ifUnused ? { ifUnused: true } : {}),
                ...(downloadId ? { downloadId } : {}),
            }, PACKAGE_DOWNLOAD_TIMEOUT_MS);
            if (res.held) {
                if (!Array.isArray(res.held.processes)) throw new Error(`Daemon held ${panelId} without naming its processes`);
                return { held: { processes: res.held.processes } };
            }
            if (!res.panel) throw new Error(`Panel install failed for ${panelId}`);
            return { panel: res.panel };
        });
    }

    /**
     * Stop and update: stops what the given updates wait for once, installs
     * each panel release and swaps in each staged package, and lets the
     * panels start their processes again. Progress and failures name their
     * target ("panel:<id>" or "package:<name>"); one failed target does not
     * stop the others.
     */
    public async updateInUse(
        targets: { panels?: Array<{ id: string; version?: string; sha256?: string }>; packages?: string[] },
        onProgress?: (target: string, payload: ProgressPayload) => void,
    ): Promise<{ panels: PanelManifest[]; failures: Record<string, string> }> {
        const progress = onProgress
            ? (payload: ProgressPayload) => {
                if (typeof payload.target !== "string") {
                    logger.error("[PaperCraneClient] update progress without its target:", payload);
                    return;
                }
                onProgress(payload.target, payload);
            }
            : undefined;
        return this.withProgress({ onProgress: progress }, async (downloadId) => {
            const res = await this.call<{ panels?: PanelManifest[]; failures?: Record<string, string> }>("update:inUse", {
                panels: targets.panels ?? [],
                packages: targets.packages ?? [],
                ...(downloadId ? { downloadId } : {}),
            }, PACKAGE_DOWNLOAD_TIMEOUT_MS);
            if (!Array.isArray(res.panels) || !res.failures || typeof res.failures !== "object") {
                throw new Error("Daemon finished the update without saying what it installed");
            }
            return { panels: res.panels, failures: res.failures };
        });
    }

    // Config operations
    public async getConfig<T = Record<string, unknown>>(
        id: string,
    ): Promise<T | null> {
        const res = await this.call<{ data: T | null }>("config:get", { id });
        return res.data;
    }

    public async setConfig(id: string, data: unknown): Promise<boolean> {
        const res = await this.call<{ success: boolean }>("config:set", { id, data });
        return res.success;
    }

    // Self-update: tells the PaperCrane daemon to download and replace its own binary
    public async updateCrane(
        version: string,
        downloadUrl: string,
        sha256: string,
        signature: string,
    ): Promise<void> {
        await this.call("system:update", { version, downloadUrl, sha256, signature });
    }

    // System info

    public async getSystemInfo(): Promise<CraneSystemInfo> {
        const info = await this.call<CraneSystemInfo>("system:info");
        if (typeof info?.os !== "string" || typeof info?.arch !== "string") {
            throw new Error(`${this.getHost()} answered system:info without its OS and architecture`);
        }
        return info;
    }
}
