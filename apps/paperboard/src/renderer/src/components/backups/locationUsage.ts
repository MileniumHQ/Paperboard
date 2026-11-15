// How full a backup location is, in words, for the chooser and settings.
import type { Accessor } from "solid-js";
import { backupLocationsApi, type BackupLocationUsage } from "@mileniumhq/paperapi";
import { createRead, type Read } from "@mileniumhq/paperui";
import { formatBytes } from "../../lib/formatBytes";

/** A location's usage, read as it appears and again each time `round` changes. */
export function createLocationUsage(locationId: string, computerId: string, round?: Accessor<number>): Read<BackupLocationUsage> {
    return createRead(() => backupLocationsApi.usage(locationId, computerId), round ? { source: round } : {});
}

export function usageText(usage: Read<BackupLocationUsage>): string {
    const failed = usage.error();
    if (failed) return `Unavailable: ${failed}`;
    const now = usage.value();
    if (!now) return "Checking space…";
    const used = `${formatBytes(now.used)} of backups`;
    return now.available === null ? `${used}, no space limit reported` : `${used}, ${formatBytes(now.available)} free`;
}
