import type { ServerCalls } from "./api";
// Player heads over the panel's bridge. The service resolves and composites
// the skin (the browser cannot: the profile endpoints send no CORS headers)
// and asks again every time, so nothing here is kept either.

export interface HeadRequest {
    name: string;
    uuid?: string;
    size?: number;
}

/** A layered head data URL, or null when the player has none; a lookup that fails throws why. */
export type HeadFetch = (request: HeadRequest) => Promise<string | null | undefined>;

/** the heads of a server's players, as its service draws them */
export const headsFrom = (calls: ServerCalls): HeadFetch => (request) =>
    calls.getPlayerSkin({ player: request.name, uuid: request.uuid, size: request.size });
