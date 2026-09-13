import { files as fileApi, system, terminal as terminalApi } from "@paperboard-dev/paperapi";
import type { TrashRemoveDeps } from "../core/trash";
import { schedulePtyDestroy } from "./ptyCleanup";
import { PANEL_ID } from "./types";

// one factory for the trash-remove transport: every destructive path
// (worlds, world reset, plugins, player data) gets the same deps — the
// duplication this replaces is how a missing onPtyData could appear in one
// call site and not the others.
export function makeTrashRemoveDeps(tag: string): TrashRemoveDeps {
    return {
        getServerDir: () => fileApi.getPath("", PANEL_ID),
        getTargetOs: async () => (await system.getInfo()).os,
        createPty: (id, opts) => terminalApi.create(id, opts),
        writePty: (id, data) => terminalApi.write(id, data),
        onPtyData: (id, cb) => terminalApi.onData(id, cb),
        onPtyExit: (id, cb) => terminalApi.onExit(id, cb),
        scheduleDestroy: (id) => {
            schedulePtyDestroy(id, (pid) => terminalApi.destroy(pid), tag);
        },
    };
}
