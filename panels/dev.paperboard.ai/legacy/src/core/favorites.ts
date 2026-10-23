// Favorite models: hearted models from any provider (Local AI, endpoints,
// coding agents), identified by connection id plus model name. The service
// owns the list (the panel's config document), validates every change, and
// drops a connection's favorites when the connection is removed.
//
// Outside chat (Ask AI, the Quick ask widget) a favorite travels as one
// string, `<connection id>|<model>`, so a flow or widget names a model on a
// specific provider. A plain model name, as configs saved before favorites
// hold, still resolves the way it always did.

import { isAgentConnectionId, isApiConnectionId, OLLAMA_PROVIDER_ID, type Connection } from "./providers";

export const MAX_FAVORITES = 50;
// a favorite's value must fit a widget option (128 characters) with the
// longest connection id ("agent-xxxxxxxx") and the separator in front
export const MAX_FAVORITE_MODEL_CHARS = 112;
const SEPARATOR = "|";

export interface FavoriteModel {
    /** the connection that serves the model: "ollama", "api-…", "agent-…" */
    provider: string;
    /** the model's name as its connection lists it */
    model: string;
}

/** A connection id's shape; whether it still exists is a separate check. */
export function isConnectionIdShape(id: string): boolean {
    return id === OLLAMA_PROVIDER_ID || isApiConnectionId(id) || isAgentConnectionId(id);
}

/** A model name a favorite may hold: non-empty, trimmed, bounded, no control characters. */
export function isFavoriteModelName(model: unknown): model is string {
    return (
        typeof model === "string" &&
        model.length > 0 &&
        model.trim() === model &&
        model.length <= MAX_FAVORITE_MODEL_CHARS &&
        // eslint-disable-next-line no-control-regex
        !/[\u0000-\u001f\u007f]/.test(model)
    );
}

export function sameFavorite(a: FavoriteModel, b: FavoriteModel): boolean {
    return a.provider === b.provider && a.model === b.model;
}

export function isFavorite(list: readonly FavoriteModel[], provider: string, model: string): boolean {
    return list.some((f) => f.provider === provider && f.model === model);
}

/**
 * The stored list as the service uses it: well-formed entries of a
 * connection that exists, without duplicates, at most MAX_FAVORITES. A
 * favorite of a removed connection disappears with it.
 */
export function sanitizeFavorites(raw: unknown, connectionIds: readonly string[]): FavoriteModel[] {
    if (!Array.isArray(raw)) return [];
    const out: FavoriteModel[] = [];
    for (const entry of raw) {
        if (out.length >= MAX_FAVORITES) break;
        if (!entry || typeof entry !== "object") continue;
        const { provider, model } = entry as Record<string, unknown>;
        if (typeof provider !== "string" || !connectionIds.includes(provider)) continue;
        if (!isFavoriteModelName(model)) continue;
        const fav = { provider, model };
        if (!out.some((f) => sameFavorite(f, fav))) out.push(fav);
    }
    return out;
}

/** Adds a favorite (idempotent). Past the cap it refuses rather than evicting one. */
export function addFavorite(list: readonly FavoriteModel[], fav: FavoriteModel): FavoriteModel[] {
    if (list.some((f) => sameFavorite(f, fav))) return [...list];
    if (list.length >= MAX_FAVORITES) {
        throw new Error(`At most ${MAX_FAVORITES} models can be favorites. Remove one first.`);
    }
    return [...list, { provider: fav.provider, model: fav.model }];
}

export function removeFavorite(list: readonly FavoriteModel[], fav: FavoriteModel): FavoriteModel[] {
    return list.filter((f) => !sameFavorite(f, fav));
}

/** A favorite as one action or widget value: `<connection id>|<model>`. */
export function favoriteValue(fav: FavoriteModel): string {
    return `${fav.provider}${SEPARATOR}${fav.model}`;
}

/**
 * Reads a model choice from an action or widget input. A prefix shaped like
 * a connection id names the provider; anything else is a plain model name
 * (configs saved before favorites), resolved by name as before.
 */
export function parseModelChoice(value: string): { provider?: string; model: string } {
    const at = value.indexOf(SEPARATOR);
    if (at > 0) {
        const provider = value.slice(0, at);
        if (isConnectionIdShape(provider)) return { provider, model: value.slice(at + 1).trim() };
    }
    return { model: value.trim() };
}

/**
 * The favorites a surface outside chat offers, labelled with their
 * provider. Coding agents answer only in chats (they work in a project
 * folder a flow or widget cannot pick), so they are left out here.
 */
export function favoriteChoices(
    favorites: readonly FavoriteModel[],
    connections: readonly Connection[],
    limit = MAX_FAVORITES,
): { label: string; value: string; description: string }[] {
    const out: { label: string; value: string; description: string }[] = [];
    for (const f of favorites) {
        if (out.length >= limit) break;
        const owner = connections.find((c) => c.id === f.provider);
        if (!owner || owner.kind === "agent") continue;
        out.push({ label: f.model, value: favoriteValue(f), description: owner.label });
    }
    return out;
}
