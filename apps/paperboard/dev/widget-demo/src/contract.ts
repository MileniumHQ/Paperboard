import { defineContract, shape } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

export const demoContract = defineContract(PANEL_ID, {
    calls: {
        increment: {
            input: shape.object({ by: shape.optional(shape.number()) }),
            output: shape.number(),
        },
    },
    state: {
        shape: shape.object({ count: shape.number(), startedAt: shape.number() }),
        initial: { count: 0, startedAt: 0 },
    },
});
