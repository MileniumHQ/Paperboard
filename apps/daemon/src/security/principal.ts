import { logger } from "../core/logger";
import { forbidden } from "../rpc/errors";

/** null is a granted host identity, never an unresolved/unauthenticated caller. */
export function requireHost(panelId: string | null, operation: string): void {
    if (panelId !== null) {
        logger.warn(`[auth] ${operation} refused for panel "${panelId}": host authority required`);
        throw forbidden(`${operation} is host-only; credential is scoped to "${panelId}"`);
    }
}

/** Default-scopes omitted panel ids to the caller's token claim. */
export function resourcePanelId(claim: string | null, requested: string | undefined): string | undefined {
    return requested ?? claim ?? undefined;
}
