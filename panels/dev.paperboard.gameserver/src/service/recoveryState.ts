import { serverLocal } from "./scope";

const local = serverLocal(() => ({ blocked: null as string | null }));
// Whether the last interrupted install or modpack change could be settled.
// While it could not, the server folder is in an unknown half-state, so
// starting the server and every install refuse (assertRecoverySettled)
// until a retry succeeds. Kept dependency-free so the install lock and the
// lifecycle can both read it without an import cycle.

export function recoveryBlock(): string | null {
    return local().blocked;
}

export function setRecoveryBlock(reason: string | null): void {
    local().blocked = reason;
}

export function assertRecoverySettled(doing: string): void {
    if (local().blocked === null) return;
    throw new Error(
        `An interrupted install could not be cleaned up (${local().blocked}). Retry the recovery from the Overview tab before ${doing}.`,
    );
}
