// The panel's background service: one long-running Node process the daemon
// supervises, whether or not a window is open. It owns the state; windows
// and the Home widget mirror it. Its own page reaches it through calls, and
// the Blocks panel and other panels through the blocks it registers.
import { blocksApi, definePanelService, type ServiceContext } from "@mileniumhq/paperapi";
import { buildGreeting } from "./lib/greet";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "./panel";

type Ctx = ServiceContext<PanelState>;

// validation lives in pure lib code (tested); this only wires it to state.
// A bad name throws with the reason, so the caller is told, never handed an
// empty success.
function greet(ctx: Ctx, name: unknown): string {
    const greeting = buildGreeting(name);
    ctx.setState({ greetingCount: ctx.state.greetingCount + 1 });
    return greeting;
}

export default definePanelService({
    // passed explicitly: ambient scope resolves to the last panel imported
    id: PANEL_ID,
    state: DEFAULT_STATE,
    // what the panel's own page calls: bridge.call("greet", "Ada")
    calls: {
        greet: (ctx: Ctx, name?: unknown) => greet(ctx, name),
    },
    async onInit(ctx) {
        // what the Blocks panel and other panels can use
        await blocksApi.panel(PANEL_ID).register({
            categories: [{ name: "General", icon: "star" }],
            commands: [
                {
                    id: "greet",
                    name: "Greet",
                    description: "Greets a person by name",
                    category: "General",
                    icon: "waving_hand",
                    text: "Greet {name}",
                    inputs: { name: { type: "text", name: "Name" } },
                    output: "text",
                    outputName: "Greeting",
                    run: (inputs: { name: string }) => greet(ctx, inputs.name),
                },
            ],
        });
        console.log(`[${PANEL_ID}] service ready.`);
    },
});
