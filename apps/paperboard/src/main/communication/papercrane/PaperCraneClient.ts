// What a computer's Paperboard Server can be asked: pairing, packages,
// panel installs, Stop and update, config, its own update and system info.
// The connection under it is PaperCraneConnection.ts.
import type { PanelManifest } from "../../../../papercrane";
import type { PackageUpdateWait } from "../../../../papercrane/enginePackages";
import { logger } from "../../../../papercrane/logger";
import type { RpcResult } from "../../../../papercrane/rpc/contract";
import { PaperCraneConnection, type ProgressPayload } from "./PaperCraneConnection";

export { type PaperCraneClientOptions, type ProgressPayload, type TargetStatus } from "./PaperCraneConnection";

export type CraneSystemInfo = RpcResult<"system:info">;
export type PairResult = RpcResult<"auth:pair">;
export type { PackageUpdateWait };

export const PACKAGE_DOWNLOAD_TIMEOUT_MS = 45 * 60_000;

export interface PanelInstallOptions {
    /** hold the install when the panel's processes run, instead of stopping them */
    ifUnused?: boolean;
    onProgress?: (payload: ProgressPayload) => void;
}

export type PanelInstallOutcome = { panel: PanelManifest } | { held: { processes: string[] } };

export class PaperCraneClient extends PaperCraneConnection {
    public async pair(code: string, clientName?: string): Promise<PairResult> {
        const res = await this.call("auth:pair", { code, clientName });
        if (res.token) {
            this.token = res.token;
        }
        return res;
    }

    public async getPackageIndex(): Promise<RpcResult<"package:getIndex">["index"]> {
        return (await this.call("package:getIndex", {})).index;
    }

    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: (payload: ProgressPayload) => void,
        expectedSha256?: string,
    ): Promise<RpcResult<"package:download">> {
        return this.withProgressId(downloadId, onProgress, async () => {
            // the daemon bounds the download itself (30 min lifetime, 45 s
            // idle) and then extracts; the RPC outlives both, never the 30 s
            // default a 1.4 GB runtime cannot meet
            const res = await this.call("package:download", { packageName, downloadId, sha256: expectedSha256 }, PACKAGE_DOWNLOAD_TIMEOUT_MS);
            return res.waiting ? { path: res.path, waiting: res.waiting } : { path: res.path };
        });
    }

    /** Runtime package updates staged on this computer and not installed yet. */
    public async pendingPackageUpdates(): Promise<PackageUpdateWait[]> {
        return (await this.call("package:pending", {})).updates;
    }

    public async listPanels(): Promise<PanelManifest[]> {
        return (await this.call("panel:list", {})).panels;
    }

    /** Running panel services on this computer, for the shell tray summary. */
    public async runningServiceCount(): Promise<number> {
        return (await this.call("service:count", {}, 5000)).running;
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
            const res = await this.call("panel:install", {
                panelId,
                version: expected.version,
                sha256: expected.sha256,
                ...(options.ifUnused ? { ifUnused: true } : {}),
                ...(downloadId ? { downloadId } : {}),
            }, PACKAGE_DOWNLOAD_TIMEOUT_MS);
            if (res.held) return { held: res.held };
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
    ): Promise<RpcResult<"update:inUse">> {
        const progress = onProgress
            ? (payload: ProgressPayload) => {
                if (typeof payload.target !== "string") {
                    logger.error("[PaperCraneClient] update progress without its target:", payload);
                    return;
                }
                onProgress(payload.target, payload);
            }
            : undefined;
        return this.withProgress({ onProgress: progress }, (downloadId) =>
            this.call("update:inUse", {
                panels: targets.panels ?? [],
                packages: targets.packages ?? [],
                ...(downloadId ? { downloadId } : {}),
            }, PACKAGE_DOWNLOAD_TIMEOUT_MS),
        );
    }

    // Config operations
    public async getConfig(id: string): Promise<unknown> {
        return (await this.call("config:get", { id })).data;
    }

    public async setConfig(id: string, data: unknown): Promise<boolean> {
        return (await this.call("config:set", { id, data })).success;
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

    public async getSystemInfo(): Promise<CraneSystemInfo> {
        return this.call("system:info", {});
    }
}
