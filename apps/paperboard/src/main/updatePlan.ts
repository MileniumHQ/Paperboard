// Update planning (electron-free): turns pinged computer state plus registry
// indexes into install tasks. Checksums are planned facts, not execution
// surprises — a registry entry without a sha256 never becomes a task, and
// each update refused that way is returned with its reason, to be shown.
import { semverGt } from "@mileniumhq/release";
import { logger } from "../../papercrane/logger";
import { errorMessage } from "@mileniumhq/paperapi/errors";

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
    // the binary's address, for a Paperboard Server update; panels and
    // packages install by id and the daemon finds their release itself
    downloadUrl?: string;
    // what the update list calls it, and where (null: this computer)
    name: string;
    computerName: string | null;
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
    // what system:info answered; a computer that couldn't say is unreachable, not planned
    sysInfo: {
        os: string;
        arch: string;
        version?: string;
        craneVersion?: string;
    };
}

// registry builds are x64 or arm64
const archKey = (arch: string) => (arch.includes("arm") ? "arm64" : "x64");

export function validSha256(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * The store index leaves unlisted panels out, so an installed panel it
 * doesn't name is looked up by its own registry record. Returns the index
 * with those records added and the lookups that failed; a panel the registry
 * has never heard of (`null`) has nothing to update to.
 */
export async function withInstalledRecords(
    computers: ComputerUpdateState[],
    registryPanels: Record<string, any>,
    fetchRecord: (id: string) => Promise<Record<string, any> | null>,
): Promise<{ panels: Record<string, any>; failures: number; reasons: string[] }> {
    const missing = new Set<string>();
    for (const comp of computers) {
        for (const panel of comp.panels) {
            if (panel.isDevLink || panel.isLinked || panel.id in registryPanels) continue;
            missing.add(panel.id);
        }
    }
    const panels = { ...registryPanels };
    const reasons: string[] = [];
    await Promise.all([...missing].map(async (id) => {
        try {
            const record = await fetchRecord(id);
            if (record?.id === id) panels[id] = record;
        } catch (err) {
            const reason = errorMessage(err);
            reasons.push(`${id}: ${reason}`);
            logger.warn(`[Updater] could not read the registry record for ${id}:`, reason);
        }
    }));
    return { panels, failures: reasons.length, reasons };
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
): Promise<{ tasks: UpdateTask[]; refused: string[] }> {
    const tasks: UpdateTask[] = [];
    const refused: string[] = [];

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
                refused.push(`${panel.name || panel.id}: the registry gave no checksum`);
                continue;
            }
            tasks.push({
                type: comp.isLocal ? "local_panel" : "ext_panel",
                computerId: comp.id,
                id: panel.id,
                version: reg.version,
                name: panel.name || panel.id,
                computerName: comp.isLocal ? null : comp.name,
                sha256: reg.sha256,
            });
        }

        for (const [pkgId, installed] of Object.entries(comp.packages)) {
            const reg = registryPackages[pkgId];
            if (!reg?.version || !(installed as any)?.version) continue;
            if (!semverGt(reg.version, (installed as any).version)) continue;
            const platformData = reg.platforms?.[`${comp.sysInfo.os}-${archKey(comp.sysInfo.arch)}`];
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
                refused.push(`${pkgId}: the registry gave no checksum`);
                continue;
            }
            tasks.push({
                type: comp.isLocal ? "local_package" : "ext_package",
                computerId: comp.id,
                id: pkgId,
                version: reg.version,
                name: typeof reg.name === "string" && reg.name ? reg.name : pkgId,
                computerName: comp.isLocal ? null : comp.name,
                sha256: pkgSha256,
            });
        }

        if (!comp.isLocal) {
            const target = `${comp.sysInfo.os === "darwin" ? "macos" : comp.sysInfo.os}-${archKey(comp.sysInfo.arch)}`;
            const craneEntry = craneDlIndex[target];
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
                refused.push(`Paperboard Server on ${comp.name}: its installed version is unknown`);
                continue;
            }
            if (semverGt(craneEntry.version, currentCraneVersion)) {
                // trust boundary: crane binary updates refuse without a
                // checksum exactly like panels and packages
                if (!validSha256(craneEntry.sha256)) {
                    refused.push(`Paperboard Server on ${comp.name}: the registry gave no checksum`);
                } else if (typeof craneEntry.signature !== "string" || !craneEntry.signature) {
                    refused.push(`Paperboard Server on ${comp.name}: the release is not signed`);
                } else {
                    tasks.push({
                        type: "ext_crane",
                        computerId: comp.id,
                        version: craneEntry.version,
                        downloadUrl:
                            craneEntry.downloadUrl ??
                            `${opts.registryUrl}/paperdl/crane/${target}/download`,
                        name: "Paperboard Server",
                        computerName: comp.name,
                        sha256: craneEntry.sha256,
                        signature: craneEntry.signature,
                    });
                }
            }
        }
    }

    return { tasks, refused };
}
