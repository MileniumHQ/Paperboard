import { logger } from "./logger";
import { forbidden } from "./rpc/errors";

/** null is a granted host identity, never an unresolved/unauthenticated caller. */
export function requireHost(panelId: string | null, operation: string): void {
    if (panelId !== null) {
        logger.warn(`[auth] ${operation} refused for panel "${panelId}": host authority required`);
        throw forbidden(`${operation} is host-only; credential is scoped to "${panelId}"`);
    }
}

/** Shared resource boundary for vault, config and files. */
export function resourcePanelId(claim: string | null, requested: string | undefined, operation: string): string | undefined {
    if (claim && requested !== undefined && requested !== claim) {
        logger.warn(`[auth] ${operation} cross-panel access refused: scope "${claim}", requested "${requested}"`);
        throw forbidden(`Cross-panel access refused: credential is scoped to "${claim}"; access is limited to "${claim}"`);
    }
    return claim ?? requested;
}
