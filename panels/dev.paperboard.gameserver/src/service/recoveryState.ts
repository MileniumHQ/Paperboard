import type { Server } from "./server";

// Whether the last interrupted install or modpack change could be settled
// (recovery.ts): while it could not, the server folder is in an unknown
// half-state, so starting the server and every install refuse until a retry
// succeeds. Kept dependency-free so the install lock and the lifecycle can
// both read it without an import cycle.

export function assertRecoverySettled(ctx: Server, doing: string): void {
    const blocked = ctx.state.recoveryBlock;
    if (blocked === null) return;
    throw new Error(`${blocked}. Retry the recovery from the Overview tab before ${doing}.`);
}
