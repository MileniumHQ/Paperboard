// The panel's background service: one long-running Node process the daemon
// supervises, whether or not a window is open. It owns the state; windows
// and the Home widget mirror it. Its own page reaches it through calls, and
// the Blocks panel and other panels through the blocks it registers.
import { blocksApi, definePanelService, type ContractContext } from "@mileniumhq/paperapi";
import { buildGreeting } from "./lib/greet";
import { PANEL_ID, panelContract } from "./panel";

type Ctx = ContractContext<typeof panelContract>;

// validation lives in pure lib code (tested); this only wires it to state.
// A bad name throws with the reason, so the caller is told, never handed an
// empty success.
function greet(ctx: Ctx, name: string): string {
    const greeting = buildGreeting(name);
    ctx.setState({ greetingCount: ctx.state.greetingCount + 1 });
    return greeting;
}

export default definePanelService({
    // the panel's id and state come with its contract
    contract: panelContract,
    // what the panel's own page calls: service.calls.greet({ name: "Ada" })
    calls: {
        greet: ({ name }, ctx) => greet(ctx, name),
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
