// The demo's service: one counter, the steps it counts by, and the time it started. Widgets read
// both through the panel bridge, so they prove service readiness too.
import { definePanelService } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

const STEPS = [1, 5, 10];

definePanelService({
    id: PANEL_ID,
    state: { count: 0, startedAt: Date.now() },
    // what the Counter widget's "Counts by" dropdown offers in Home's gallery
    widgetChoices: {
        counter: {
            step: () => STEPS.map((step) => ({ value: String(step), label: step === 1 ? "Ones" : `${step}s` })),
        },
    },
    actions: {
        increment: (ctx, by: unknown = 1) => {
            if (typeof by !== "number" || !STEPS.includes(by)) throw new Error(`The counter counts by ${STEPS.join(", ")}`);
            ctx.setState({ count: ctx.state.count + by });
            return ctx.state.count;
        },
    },
});
