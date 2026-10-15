// Whether the last interrupted install or modpack change could be settled.
// While it could not, the server folder is in an unknown half-state, so
// starting the server and every install refuse (assertRecoverySettled)
// until a retry succeeds. Kept dependency-free so the install lock and the
// lifecycle can both read it without an import cycle.

let blocked: string | null = null;

export function recoveryBlock(): string | null {
    return blocked;
}

export function setRecoveryBlock(reason: string | null): void {
    blocked = reason;
}

export function assertRecoverySettled(doing: string): void {
    if (blocked === null) return;
    throw new Error(
        `An interrupted install could not be cleaned up (${blocked}). Retry the recovery from the Overview tab before ${doing}.`,
    );
}
