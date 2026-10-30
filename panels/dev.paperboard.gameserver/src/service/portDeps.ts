import { files as fileApi, portApi } from "./api";
import type { PortDeps } from "./ports";
import { PANEL_ID } from "./types";

/** The daemon-backed dependencies of the server's port claims. */
export function livePortDeps(): PortDeps {
    return {
        serverDir: () => fileApi.getPath("", PANEL_ID),
        ports: {
            claim: (request) => portApi.claim(PANEL_ID, request),
            prepare: (name) => portApi.prepare(PANEL_ID, name),
            release: (name) => portApi.release(PANEL_ID, name),
        },
    };
}
