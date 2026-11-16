// The Blocks panel's service: it keeps the projects and their flows, listens
// for the events the switched-on projects start from, and runs them, whether
// or not a window is open (runtime.ts). The page edits one project's flows
// at a time and shows the run log this service keeps.
import { blocksApi, config, definePanelService } from "@mileniumhq/paperapi";
import { createRuntime } from "./runtime";
import { PANEL_ID, blocksContract } from "./panel";

const runtime = createRuntime({
    storage: {
        get: (path) => config.get<unknown>(PANEL_ID, path),
        set: async (value, path) => {
            await config.set(value, PANEL_ID, path);
        },
    },
    blocks: blocksApi,
    handle: blocksApi.panel(PANEL_ID),
});

export default definePanelService({
    contract: blocksContract,
    calls: runtime.calls,
    onInit: (ctx) => runtime.init(ctx.setState),
    onPagesChanged: (_ctx, open) => runtime.pagesChanged(open),
});
