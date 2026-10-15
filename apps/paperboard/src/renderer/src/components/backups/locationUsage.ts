// How full a backup location is, in words, for the chooser and settings.
import { backupLocationsApi, type BackupLocationUsage } from "@mileniumhq/paperapi";
import { formatBytes } from "../home/builtins/usageSegments";

export type UsageState = { kind: "loading" } | { kind: "ready"; usage: BackupLocationUsage } | { kind: "failed"; message: string };

export function usageText(state: UsageState): string {
    if (state.kind === "loading") return "Checking space…";
    if (state.kind === "failed") return `Unavailable: ${state.message}`;
    const used = `${formatBytes(state.usage.used)} of backups`;
    return state.usage.available === null ? `${used}, no space limit reported` : `${used}, ${formatBytes(state.usage.available)} free`;
}

export async function loadUsage(locationId: string, computerId: string): Promise<UsageState> {
    try {
        return { kind: "ready", usage: await backupLocationsApi.usage(locationId, computerId) };
    } catch (err) {
        console.warn(`[backups] usage of ${locationId} unavailable:`, err);
        return { kind: "failed", message: (err as Error)?.message ?? String(err) };
    }
}
