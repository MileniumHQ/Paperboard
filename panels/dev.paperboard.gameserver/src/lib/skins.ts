// The panel's head cache, over the panel's bridge (see headCache.ts).
import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import { createHeadLoader } from "./headCache";

const heads = createHeadLoader((request) =>
    serverBridge.call<string | null>(ACTION_IDS.getPlayerSkin, {
        player: request.name,
        uuid: request.uuid,
        size: request.size,
    }),
);

export const peekHead = heads.peekHead;
export const loadHead = heads.loadHead;
