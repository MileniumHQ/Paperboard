import { config, processApi } from "./api";
import { PANEL_ID, SERVER_PROC_ID } from "./types";

/**
 * Sends the console edits saved under `key` while the server was offline,
 * then clears them: a later in-game change must not be clobbered by a stale
 * saved value on the next boot. `commands` re-validates them (the config is
 * user-editable and these strings become console commands) and throws to
 * refuse them. Any failure throws and the edits stay saved for the next boot.
 */
export async function applyPendingEdits(key: string, commands: (pending: Record<string, unknown>) => string[]): Promise<void> {
    const saved = await config.get<Record<string, unknown> | null>(PANEL_ID);
    const pending = saved?.[key];
    if (!pending || typeof pending !== "object" || Object.keys(pending).length === 0) return;
    for (const line of commands(pending as Record<string, unknown>)) await processApi.write(SERVER_PROC_ID, `${line}\n`);
    // re-read: the config may have changed while the commands went out
    const fresh = await config.get<Record<string, unknown> | null>(PANEL_ID);
    await config.set({ ...(fresh && typeof fresh === "object" ? fresh : {}), [key]: {} }, PANEL_ID);
}
