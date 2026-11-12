// Player heads over the panel's bridge. The service resolves and composites
// the skin (the browser cannot: the profile endpoints send no CORS headers)
// and asks again every time, so nothing here is kept either.
import { serverBridge } from "./server";
import { CALLS } from "../service/contract";

export interface HeadRequest {
    name: string;
    uuid?: string;
    size?: number;
}

/** A layered head data URL, or null when the player has none. */
export type HeadFetch = (request: HeadRequest) => Promise<string | null | undefined>;

export const loadHead: HeadFetch = (request) =>
    serverBridge.call<string | null>(CALLS.getPlayerSkin, {
        player: request.name,
        uuid: request.uuid,
        size: request.size,
    });
