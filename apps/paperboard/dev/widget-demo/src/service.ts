// The demo's service: one counter and the time it started. Widgets read
// both through the panel bridge, so they prove service readiness too.
import { definePanelService } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

definePanelService({
    id: PANEL_ID,
    state: { count: 0, startedAt: Date.now() },
    actions: {
        increment: (ctx) => {
            ctx.setState({ count: ctx.state.count + 1 });
            return ctx.state.count;
        },
    },
});
