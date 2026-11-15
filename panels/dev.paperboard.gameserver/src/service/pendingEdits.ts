import type { Server } from "./server";

import { SERVER_PROC_ID } from "./types";

/**
 * Sends the console edits saved under `key` while the server was offline,
 * then clears them: a later in-game change must not be clobbered by a stale
 * saved value on the next boot. `commands` re-validates them (the config is
 * user-editable and these strings become console commands) and throws to
 * refuse them. Any failure throws and the edits stay saved for the next boot.
 */
export async function applyPendingEdits(ctx: Server, key: string, commands: (pending: Record<string, unknown>) => string[]): Promise<void> {
    const pending = ctx.settings[key];
    if (!pending || typeof pending !== "object" || Object.keys(pending).length === 0) return;
    for (const line of commands(pending as Record<string, unknown>)) await ctx.process.write(SERVER_PROC_ID, `${line}\n`);
    await ctx.updateSettings({ [key]: {} });
}
