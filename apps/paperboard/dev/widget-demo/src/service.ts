// The demo's service: one counter, the steps it counts by, and the time it started. Widgets read
// both through the panel bridge, so they prove service readiness too.
import { definePanelService } from "@mileniumhq/paperapi";
import { demoContract } from "./contract";

const STEPS = [1, 5, 10];

definePanelService({
    contract: demoContract,
    // what the Counter widget's "Counts by" dropdown offers in Home's gallery
    widgetChoices: {
        counter: {
            step: () => STEPS.map((step) => ({ value: String(step), label: step === 1 ? "Ones" : `${step}s` })),
        },
    },
    onInit: (ctx) => {
        ctx.setState({ startedAt: Date.now() });
    },
    calls: {
        increment: ({ by = 1 }, ctx) => {
            if (!STEPS.includes(by)) throw new Error(`The counter counts by ${STEPS.join(", ")}`);
            ctx.setState({ count: ctx.state.count + by });
            return ctx.state.count;
        },
    },
});
