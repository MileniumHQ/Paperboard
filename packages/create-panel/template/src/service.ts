import {
    definePanelService,
    defineAction,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import { buildGreeting } from "./lib/greet";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
const PANEL_ID = "__PANEL_ID__";

interface StarterServiceState {
    greetingCount: number;
}

type Ctx = ServiceContext<StarterServiceState>;

const actions = [
    defineAction({
        id: "greet",
        name: "Greet",
        category: "General",
        description: "Greets a person by name",
        template: "Greet {name}",
        inputs: {
            name: { type: "string", label: "Name", placeholder: "Ada", required: true },
        },
        output: { type: "string", label: "Greeting" },
        icon: "waving_hand",
        run: async (ctx: Ctx, inputs: { name?: string }) => {
            // validation lives in pure lib code (tested); the action only
            // wires it to state. Invalid input throws a typed error, never
            // an empty success.
            const greeting = buildGreeting(inputs?.name);
            ctx.setState({
                greetingCount: (ctx.state.greetingCount ?? 0) + 1,
            });
            return greeting;
        },
    }),
];

export const starterService = definePanelService({
    id: PANEL_ID,
    state: { greetingCount: 0 },
    categories: [{ name: "General", icon: "star", order: 1 }],
    actions,
    async onInit(_ctx: Ctx) {
        console.log(`[${PANEL_ID}] service ready.`);
    },
});

export default starterService;
