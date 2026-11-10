// A panel service for the daemon tests, run as its own process with the boot
// environment the daemon gives services. PANEL_SCENARIO picks what it
// registers; it prints READY once every registration is acknowledged.
import { actionsApi, defineAction, defineType } from "../../src/actions";
import { blocksApi } from "../../src/blocks";
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

// Blocks (Actions API v2): a type with a field read off the value and one
// the panel looks up, and a project with a command, a value that says when
// it changes, and an event. "join" fires the event and the change, so the
// test drives both from outside; "misfire" tries payloads the event never
// declared and answers what the SDK refused.
async function blocks(): Promise<void> {
    const online: string[] = [];
    let kicks = 0;
    await blocksApi.panel().register({
        types: [
            {
                id: "player",
                name: "Player",
                base: "object",
                fields: {
                    name: { type: "text", name: "Name" },
                    shout: { type: "text", name: "Shout", resolve: (p: { name: string }) => `${p.name.toUpperCase()}!` },
                },
            },
        ],
    });
    const server = await blocksApi.defineProject({ id: "s1", name: "Survival", icon: "dns" });
    await server.register({
        commands: [
            {
                id: "kick",
                name: "Kick Player",
                text: "Kick {player} because {reason}",
                inputs: {
                    player: { type: "player", name: "Player" },
                    reason: { type: "text", name: "Reason", optional: true, maxLength: 20 },
                },
                output: "number",
                run: () => ++kicks,
            },
            { id: "lie", name: "Lie", output: "number", run: () => "not a number" },
            {
                id: "join",
                name: "Join",
                inputs: { name: { type: "text", name: "Name" } },
                run: async ({ name }: { name: string }) => {
                    online.push(name);
                    await server.fire("joined", { player: { name } });
                    await server.changed("online");
                },
            },
            {
                id: "misfire",
                name: "Misfire",
                output: "list<text>",
                run: async () => {
                    const refused: string[] = [];
                    for (const payload of [{ player: { name: 7 } }, { player: { name: "a" }, extra: 1 }, {}]) {
                        await server.fire("joined", payload as never).then(
                            () => refused.push("fired"),
                            (err: Error) => refused.push(err.message),
                        );
                    }
                    return refused;
                },
            },
        ],
        values: [
            { id: "online", name: "Online Players", type: "list<player>", changes: true, read: () => online.map((name) => ({ name })) },
            { id: "kicks", name: "Kicks", type: "number", read: () => kicks },
        ],
        events: [
            {
                id: "joined",
                name: "When a Player Joins",
                values: { player: { type: "player", name: "Player" } },
            },
        ],
    });
}

const scenarios: Record<string, () => Promise<void>> = { inputs, owner, blocks };
const scenario = scenarios[process.env.PANEL_SCENARIO ?? ""];
if (!scenario) throw new Error(`unknown PANEL_SCENARIO ${process.env.PANEL_SCENARIO}`);
await scenario();
process.stdout.write("READY\n");
