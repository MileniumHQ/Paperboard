// Update planning (electron-free): turns pinged computer state plus registry
// indexes into install tasks. Checksums are planned facts, not execution
// surprises — a registry entry without a sha256 never becomes a task.
import { semverGt } from "../../papercrane/util";
import { logger } from "../../papercrane/logger";

export type UpdateTaskType =
    | "local_panel"
    | "local_package"
    | "ext_panel"
    | "ext_package"
    | "ext_crane";

export interface UpdateTask {
    type: UpdateTaskType;
    computerId: string;
    id?: string;
    version: string;
    downloadUrl: string;
    label: string;
    sha256?: string;
    // offline release-key signature (crane binaries); the daemon verifies it
    signature?: string;
}

export interface PanelUpdateInfo {
    id: string;
    version?: string;
    name?: string;
    isDevLink?: boolean;
    isLinked?: boolean;
}

export interface ComputerUpdateState {
    id: string;
    name: string;
    isLocal: boolean;
    panels: PanelUpdateInfo[];
    packages: Record<string, { version?: string }>;
    sysInfo: {
        os?: string;
        arch?: string;
        version?: string;
        craneVersion?: string;
    } | null;
}

export function validSha256(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export async function planUpdateTasks(
    computers: ComputerUpdateState[],
    registryPanels: Record<string, any>,
    registryPackages: Record<string, any>,
    craneDlIndex: Record<string, any>,
    opts: {
        registryUrl: string;
        readCraneVersion: (computerId: string) => Promise<string | null>;
    },
): Promise<UpdateTask[]> {
    const tasks: UpdateTask[] = [];

    for (const comp of computers) {
        for (const panel of comp.panels) {
            if (panel.isDevLink || panel.isLinked) {
                logger.debug(`[Updater] Skipping update for dev-linked panel: ${panel.id}`);
                continue;
            }
            const reg = registryPanels[panel.id];
            if (!reg?.version || !panel.version) continue;
            if (!semverGt(reg.version, panel.version)) continue;
            // trust boundary: same rule as packages and crane — no checksum
            // fact, no task. Checksum-less entries are refused here at plan
            // time, never as a confusing "Done (1 failed)" at execution.
            if (!validSha256(reg.sha256)) {
                logger.warn(
                    `[Updater] Refusing panel update for ${panel.id}: registry did not provide a sha256 checksum`,
                );
                continue;
            }
            tasks.push({
                type: comp.isLocal ? "local_panel" : "ext_panel",
                computerId: comp.id,
                id: panel.id,
                version: reg.version,
                downloadUrl:
                    reg.downloadUrl ??
                    `${opts.registryUrl}/panel/${panel.id}/download`,
                label: `Updating panel ${panel.name || panel.id}${comp.isLocal ? "" : ` on ${comp.name}`}`,
                sha256: reg.sha256,
            });
        }

        for (const [pkgId, installed] of Object.entries(comp.packages)) {
            const reg = registryPackages[pkgId];
            if (!reg?.version || !(installed as any)?.version) continue;
            if (!semverGt(reg.version, (installed as any).version)) continue;
            const platform: string = comp.sysInfo?.os ?? "linux";
            const arch: string = (comp.sysInfo?.arch ?? "x64").includes("arm")
                ? "arm64"
                : "x64";
            const platformData = reg.platforms?.[`${platform}-${arch}`];
            if (!platformData?.url) continue;
            // trust boundary: same rule as panels — no checksum fact, no task.
            // a registry entry without sha256 never becomes an install
            const pkgSha256 =
                typeof platformData.sha256 === "string"
                    ? platformData.sha256
                    : typeof reg.sha256 === "string"
                      ? reg.sha256
                      : undefined;
            if (!validSha256(pkgSha256)) {
                logger.warn(
                    `[Updater] Refusing package update for ${pkgId}: registry did not provide a sha256 checksum`,
                );
                continue;
            }
            tasks.push({
                type: comp.isLocal ? "local_package" : "ext_package",
                computerId: comp.id,
                id: pkgId,
                version: reg.version,
                downloadUrl: platformData.url,
                label: `Updating ${pkgId}${comp.isLocal ? "" : ` on ${comp.name}`}`,
                sha256: pkgSha256,
            });
        }

        if (!comp.isLocal && comp.sysInfo) {
            const platform: string =
                comp.sysInfo.os === "darwin" ? "macos" : comp.sysInfo.os ?? "linux";
            const arch: string = (comp.sysInfo.arch ?? "x64").includes("arm")
                ? "arm64"
                : "x64";
            const craneEntry = craneDlIndex[`${platform}-${arch}`];
            if (!craneEntry?.version) continue;

            let currentCraneVersion: string | null =
                comp.sysInfo.version || comp.sysInfo.craneVersion || null;
            if (!currentCraneVersion) {
                currentCraneVersion = await opts.readCraneVersion(comp.id);
            }

            // unknown installed version: refuse to plan. Replacing a binary
            // we cannot compare risks a silent downgrade, and planning it
            // anyway contradicts "planned facts, not execution surprises".
            // The next run retries once the version is readable.
            if (!currentCraneVersion) {
                logger.warn(
                    `[Updater] Skipping Paperboard Server update on ${comp.name}: installed version unknown`,
                );
                continue;
            }
            if (semverGt(craneEntry.version, currentCraneVersion)) {
                // trust boundary: crane binary updates refuse without a
                // checksum exactly like panels and packages
                if (!validSha256(craneEntry.sha256)) {
                    logger.warn(
                        `[Updater] Refusing Paperboard Server update on ${comp.name}: registry did not provide a sha256 checksum`,
                    );
                } else if (typeof craneEntry.signature !== "string" || !craneEntry.signature) {
                    logger.warn(
                        `[Updater] Refusing Paperboard Server update on ${comp.name}: the release is not signed`,
                    );
                } else {
                    tasks.push({
                        type: "ext_crane",
                        computerId: comp.id,
                        version: craneEntry.version,
                        downloadUrl:
                            craneEntry.downloadUrl ??
                            `${opts.registryUrl}/paperdl/crane/${platform}-${arch}/download`,
                        label: `Updating Paperboard Server on ${comp.name}`,
                        sha256: craneEntry.sha256,
                        signature: craneEntry.signature,
                    });
                }
            }
        }
    }

    return tasks;
}
