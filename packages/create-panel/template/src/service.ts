// The panel's background service: one long-running Node process the daemon
// supervises, whether or not a window is open. It owns the state; windows
// and the Home widget mirror it, and other panels reach it through actions.
import { definePanelService, defineAction, type ServiceContext } from "@mileniumhq/paperapi";
import { buildGreeting } from "./lib/greet";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "./panel";

type Ctx = ServiceContext<PanelState>;

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
            // wires it to state. A bad name throws with the reason, so the
            // caller is told, never handed an empty success.
            const greeting = buildGreeting(inputs?.name);
            ctx.setState({ greetingCount: ctx.state.greetingCount + 1 });
            return greeting;
        },
    }),
];

export default definePanelService({
    // passed explicitly: ambient scope resolves to the last panel imported
    id: PANEL_ID,
    state: DEFAULT_STATE,
    categories: [{ name: "General", icon: "star", order: 1 }],
    actions,
    async onInit() {
        console.log(`[${PANEL_ID}] service ready.`);
    },
});
