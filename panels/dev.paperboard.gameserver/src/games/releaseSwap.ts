import fs from "node:fs/promises";
import { exists } from "../service/failures";

// A game release downloaded from its publisher is unpacked into a staging
// folder, then swapped in for the installed one. Both folders hold only the
// release's own files, never worlds or settings. The old release waits at
// `<target>.previous` until the new one is in place, so a swap a crash cut
// short is finished or undone the next time the service starts.

/** Finishes or undoes a swap that was cut short; nothing to do after a whole one. */
export async function recoverRelease(target: string): Promise<void> {
    const previous = `${target}.previous`;
    if (!(await exists(previous))) return;
    if (await exists(target)) await fs.rm(previous, { recursive: true });
    else await fs.rename(previous, target);
}

/** Puts the staged release where the installed one was; a failed rename puts the old one back. */
export async function activateRelease(staging: string, target: string, game: string): Promise<void> {
    const previous = `${target}.previous`;
    if (await exists(previous)) throw new Error(`A ${game} release swap needs recovery; restart the panel service before installing`);
    const replacing = await exists(target);
    if (replacing) await fs.rename(target, previous);
    try { await fs.rename(staging, target); }
    catch (err) { if (replacing) await fs.rename(previous, target); throw err; }
    if (replacing) await fs.rm(previous, { recursive: true });
}
