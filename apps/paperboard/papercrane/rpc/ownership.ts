// Supervised terminal/process id ownership (one invariant, one module).
// The engine keeps the ledger (id → creating panel claim); these helpers
// are the only RPC-layer readers/writers. A scoped caller touching or
// re-creating an id another panel owns is refused. Unclaimed ids
// (master-created) stay shared.
import type { RpcContext } from "./context";
import { forbidden } from "./errors";

function assertNotForeign(id: string, ctx: RpcContext, what: string): void {
    const claim = ctx.callerPanelId();
    const owner = ctx.engine.clientOwner(id);
    if (claim && owner && claim !== owner) {
        throw forbidden(`[${what}] "${id}" belongs to another panel`);
    }
}

// Reserve the creator claim before start makes the workload visible. A
// failed start restores the previous ledger; an immediate exit leaves no
// claim. Other panels cannot act on or recreate an id during its start.
export async function claimClient<T>(id: unknown, ctx: RpcContext, what: string, start: () => Promise<T>): Promise<T> {
    const named = typeof id === "string" && id ? id : null;
    if (!named) return start();
    assertNotForeign(named, ctx, what);
    const reservation = ctx.engine.reserveClientOwner(named, ctx.callerPanelId());
    try {
        const result = await start();
        reservation.commit();
        return result;
    } catch (err) {
        reservation.undo();
        throw err;
    }
}

// every other id action calls this before touching the client.
export function checkClientOwnership(id: unknown, ctx: RpcContext, what: string): void {
    if (typeof id !== "string" || !id) return;
    assertNotForeign(id, ctx, what);
}

// credential-bearing env keys no caller may plant in a spawned child: the
// credential is issued by the daemon, never chosen by the caller.
const RESERVED_ENV_KEYS = new Set([
    "PAPERCRANE_TOKEN",
    "PAPERCRANE_PANEL_TOKEN",
    "PAPERBOARD_PANEL_ID",
]);

export function checkSpawnEnv(
    env: Record<string, string> | undefined,
    _ctx: RpcContext,
    what: string,
): void {
    if (!env) return;
    for (const key of Object.keys(env)) {
        if (RESERVED_ENV_KEYS.has(key)) {
            throw forbidden(
                `[${what}] overriding "${key}" in a spawned child env is refused: the credential is issued, not chosen`,
            );
        }
    }
}
