// A panel service for the daemon tests, run as its own process with the boot
// environment the daemon gives services. PANEL_SCENARIO picks what it
// registers; it prints READY once every registration is acknowledged.
import { actionsApi, defineAction, defineType } from "../../src/actions";
import { getPanelId } from "../../src/ipc";

const panelId = getPanelId();
if (!panelId) throw new Error("the panel service booted without a panel id");

let runs = 0;

async function inputs(): Promise<void> {
    await actionsApi.register(
        defineAction({
            id: "greet",
            name: "Greet",
            description: "",
            inputs: {
                name: { type: "string", label: "Name", required: true },
                tags: { type: "list<string>", label: "Tags", required: true },
                nickname: { type: "string", label: "Nickname" },
            },
            run: (_ctx, values: { name: string }) => {
                runs++;
                return `Hello, ${values.name}`;
            },
        }),
    );
    await actionsApi.register(
        defineAction({
            id: "limited",
            name: "Limited",
            description: "",
            inputs: {
                count: { type: "number", label: "Count", min: 1, max: 10, integer: true },
                note: { type: "string", label: "Note", maxLength: 5 },
                ids: { type: "list<number>", label: "IDs", maxItems: 2, min: 0 },
            },
            run: () => {
                runs++;
                return "ran";
            },
        }),
    );
    // types the flow builder learns from the registration: a list of a
    // custom type whose field is another custom type
    defineType({ id: "test.member", name: "Member", base: "object", fields: { role: { type: "test.role" } }, toString: (v) => String(v?.name) });
    defineType({ id: "test.role", name: "Role", base: "string" });
    await actionsApi.register(
        defineAction({
            id: "members",
            name: "Members",
            description: "",
            inputs: { who: { type: "list<test.member>", label: "Who" } },
            run: () => [],
        }),
    );
    await actionsApi.register("runs", () => runs);
}

// the same action name every panel registers, answering with its owner
async function owner(): Promise<void> {
    await actionsApi.register("whoami", () => panelId);
}

const scenarios: Record<string, () => Promise<void>> = { inputs, owner };
const scenario = scenarios[process.env.PANEL_SCENARIO ?? ""];
if (!scenario) throw new Error(`unknown PANEL_SCENARIO ${process.env.PANEL_SCENARIO}`);
await scenario();
process.stdout.write("READY\n");
