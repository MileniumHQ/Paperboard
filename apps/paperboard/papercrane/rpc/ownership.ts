// Supervised terminal/process id ownership (one invariant, one module).
// The engine keeps the ledger (id → creating panel claim); these helpers
// are the only RPC-layer readers/writers. A scoped caller touching an id
// owned by another panel logs loudly and stays allowed — deprecation now,
// enforcement at the registry-opening gate (TODO deny after v3.2), zero
// broken flows. Unclaimed ids (master-created, pre-ledger) stay shared.
import { logger } from "../logger";
import type { RpcContext } from "./context";
import { forbidden } from "./errors";

// create paths call this: records the creator claim, warns when stealing
// an id another scoped panel owns, then lets the create proceed.
export function claimClient(id: unknown, ctx: RpcContext, what: string): void {
    if (typeof id !== "string" || !id) return;
    const claim = ctx.callerPanelId();
    const owner = ctx.engine.clientOwner(id);
    if (claim && owner && claim !== owner) {
        logger.warn(
            `[${what}] id "${id}" owned by panel "${owner}" re-created by scoped caller "${claim}". ` +
            `TODO(deny after v3.2): ownership mismatches are denied at registry-open.`,
        );
    }
    ctx.engine.setClientOwner(id, claim);
}

// every other id action calls this before touching the client.
export function checkClientOwnership(id: unknown, ctx: RpcContext, what: string): void {
    if (typeof id !== "string" || !id) return;
    const claim = ctx.callerPanelId();
    const owner = ctx.engine.clientOwner(id);
    if (claim && owner && claim !== owner) {
        logger.warn(
            `[${what}] id "${id}" owned by panel "${owner}" touched by scoped caller "${claim}". ` +
            `TODO(deny after v3.2): ownership mismatches are denied at registry-open.`,
        );
    }
}

// credential-bearing env keys no caller may plant in a spawned child.
// A scoped caller overriding these is refused outright (no legitimate
// flow re-issues its own credential — services already inherit it). A
// master/host caller warns loudly, tombstoned to deny after v3.2.
const RESERVED_ENV_KEYS = new Set([
    "PAPERCRANE_TOKEN",
    "PAPERCRANE_PANEL_TOKEN",
    "PAPERBOARD_PANEL_ID",
]);

export function checkSpawnEnv(
    env: Record<string, string> | undefined,
    ctx: RpcContext,
    what: string,
): void {
    if (!env) return;
    const claim = ctx.callerPanelId();
    for (const key of Object.keys(env)) {
        if (!RESERVED_ENV_KEYS.has(key)) continue;
        if (claim) {
            logger.warn(
                `[${what}] scoped caller "${claim}" attempted to override "${key}" in a child env — refused`,
            );
            throw forbidden(
                `Overriding "${key}" in a spawned child env is refused: the credential is issued, not chosen`,
            );
        }
        logger.warn(
            `[${what}] master caller overriding "${key}" in a child env. ` +
            `TODO(deny after v3.2): credential overrides are denied at registry-open.`,
        );
    }
}
