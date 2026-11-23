// A panel service for the daemon tests, run as its own process with the boot
// environment the daemon gives services. PANEL_SCENARIO picks what it
// registers; it prints READY once every registration is acknowledged.
import { blocksApi } from "../../src/blocks";
import { defineContract } from "../../src/contract";
import { definePanelService } from "../../src/service";
import { callBlockId } from "../../src/serviceCalls";
import { getPanelId } from "../../src/ipc";
import { notesContract, SERVICE, serviceContract } from "./contract";

const panelId = getPanelId();
if (!panelId) throw new Error("the panel service booted without a panel id");

// Blocks (Actions API v2): a type with a field read off the value and one
// the panel looks up, and a project with a command, a value that says when
// it changes, and an event. "join" fires the event and the change, so the
// test drives both from outside; "misfire" tries payloads the event never
// declared and answers what the SDK refused.
async function blocks(): Promise<void> {
    const online: string[] = [];
    const worlds = ["world"];
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
                    nickname: { type: "text", name: "Nickname", optional: true },
                    online: {
                        type: "boolean",
                        name: "Online",
                        perProject: true,
                        resolve: (p: { name: string }, ctx) => {
                            if (ctx.project !== "s1") throw new Error(`asked in ${String(ctx.project)}`);
                            return online.includes(p.name);
                        },
                    },
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
                outputName: "Kicks",
                run: () => ++kicks,
            },
            { id: "lie", name: "Lie", output: "number", outputName: "Lie", run: () => "not a number" },
            // the panel's own page calls it; no other panel may, and nothing lists it
            { id: "reset-kicks", name: "Reset Kicks", internal: true, output: "number", outputName: "Kicks", run: () => (kicks = 0) },
            {
                id: "warp",
                name: "Warp",
                text: "Warp to {world} {times} times",
                inputs: {
                    world: { type: "text", name: "World", choices: () => worlds.map((w) => ({ label: w, value: w })) },
                    times: { type: "number", name: "Times", default: 1, min: 1 },
                },
                output: "text",
                outputName: "Destination",
                run: ({ world, times }: { world: string; times: number }) => `${world} x${times}`,
            },
            {
                id: "create-world",
                name: "Create World",
                inputs: { world: { type: "text", name: "World" } },
                run: ({ world }: { world: string }) => {
                    worlds.push(world);
                },
            },
            {
                id: "leave",
                name: "Leave",
                inputs: { name: { type: "text", name: "Name" } },
                run: async ({ name }: { name: string }) => {
                    await server.fire("left", { player: { name } });
                    await server.fire("left", { player: { name }, reason: null });
                    await server.fire("left", { player: { name }, reason: "kicked" });
                },
            },
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
                outputName: "Refusals",
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
            {
                id: "left",
                name: "When a Player Leaves",
                values: { player: { type: "player", name: "Player" }, reason: { type: "text", name: "Reason", optional: true } },
            },
        ],
    });
}

// a panel service as panels write one: calls its page makes, events it
// emits, state it keeps, and a widget option's choices
async function service(): Promise<void> {
    if (panelId !== SERVICE) {
        const s = definePanelService({ contract: defineContract(panelId, {}) });
        await s.ready;
        return;
    }
    const s = definePanelService({
        contract: serviceContract,
        calls: {
            addItem: (input, ctx) => {
                const items = [...ctx.state.items, input.name];
                ctx.setState({ items });
                ctx.emit("itemAdded", { name: input.name, count: items.length });
                return items.length;
            },
            forget: () => undefined,
            fail: () => {
                throw new Error("the service said no");
            },
        },
        widgetChoices: {
            pinned: { item: (ctx) => ctx.state.items.map((name) => ({ label: name, value: name })) },
        },
    });
    await s.ready;
}

// another panel, which tries its neighbour's blocks and service calls
async function caller(): Promise<void> {
    await blocksApi.panel().register({
        commands: [
            {
                id: "reach-in",
                name: "Reach In",
                inputs: { panel: { type: "text", name: "Panel" } },
                output: "text",
                outputName: "Answer",
                run: ({ panel }: { panel: string }) =>
                    blocksApi.run(panel, "reset-kicks", {}, { project: "s1" }).then(
                        (result) => `ran: ${JSON.stringify(result)}`,
                        (err: Error) => `refused: ${err.message}`,
                    ),
            },
            {
                id: "reach-call",
                name: "Reach Call",
                inputs: { panel: { type: "text", name: "Panel" } },
                output: "text",
                outputName: "Answer",
                run: ({ panel }: { panel: string }) =>
                    blocksApi.run(panel, callBlockId("addItem"), { input: { name: "intruder" } }).then(
                        (result) => `ran: ${JSON.stringify(result)}`,
                        (err: Error) => `refused: ${err.message}`,
                    ),
            },
        ],
    });
}

// a panel service on a contract: the same page and service, typed and checked
async function notes(): Promise<void> {
    const notes: { id: string; book: string; text: string; pinned: boolean }[] = [];
    let handlerRuns = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const service = definePanelService({
        contract: notesContract,
        calls: {
            addNote: (input, ctx, { book }) => {
                handlerRuns++;
                const note = { id: `n${notes.length + 1}`, book, text: input.text, pinned: input.pinned ?? false };
                notes.push(note);
                ctx.setState({ count: ctx.state.count + 1, last: note.text });
                ctx.emit("noteAdded", note);
                return note;
            },
            listNotes: (_input, _ctx, { book }) => {
                handlerRuns++;
                return notes.filter((n) => n.book === book);
            },
            clear: () => {
                handlerRuns++;
                notes.length = 0;
            },
            handlerRuns: () => handlerRuns,
            // what an untyped handler could always do: answer what the page doesn't expect
            brokenAnswer: () => JSON.parse('{"id":"n0","book":"b","text":7,"pinned":false}'),
            brokenState: (_input, ctx) => ctx.setState(JSON.parse('{"count":"many"}')),
            held: () => held,
            release: () => release(),
            draft: ({ text }, ctx, { book }) => ctx.keyed.drafts.set(book, { text, words: text.split(" ").length }),
            discardDraft: (_input, ctx, { book }) => ctx.keyed.drafts.delete(book),
            brokenDraft: (_input, ctx, { book }) => ctx.keyed.drafts.set(book, JSON.parse('{"text":"x","words":"one"}')),
            books: (_input, ctx) => [...new Set([...notes.map((n) => n.book), ...ctx.keyed.drafts.keys()])].sort(),
        },
    });
    await service.ready;
}

// a service whose start fails: it never reports ready
async function brokenInit(): Promise<void> {
    definePanelService({
        state: {},
        onInit: () => {
            throw new Error("the config file is unreadable");
        },
    });
    await new Promise(() => {});
}

const scenarios: Record<string, () => Promise<void>> = { blocks, caller, service, notes, brokenInit };
const scenario = scenarios[process.env.PANEL_SCENARIO ?? ""];
if (!scenario) throw new Error(`unknown PANEL_SCENARIO ${process.env.PANEL_SCENARIO}`);
await scenario();
process.stdout.write("READY\n");
