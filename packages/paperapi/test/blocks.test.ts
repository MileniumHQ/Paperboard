import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsApi } from "../src/actions";
import { blocksApi, memoryBlocks, validateBlockDefinitions, valueProblem, type BlockSet } from "../src/blocks";
import { closeTransport } from "../src/ipc";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

setDefaultTimeout(60_000);

const PANEL = "dev.test.blocks";
let daemon: Daemon;
let panels: PanelProcess[] = [];

beforeAll(async () => {
    daemon = await startDaemon();
    panels = [await daemon.startPanel(PANEL, "blocks")];
});

afterAll(async () => {
    for (const panel of panels) await panel.stop();
    closeTransport();
    await daemon.stop();
});

// the caller is this test process (the host), as the Blocks panel will be:
// every block runs in the panel's own process, through the daemon
const run = (command: string, inputs?: Record<string, unknown>) => blocksApi.run(PANEL, command, inputs, { project: "s1" });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (value: string) => blocksApi.read(PANEL, value, undefined, { project: "s1" });

describe("a panel's blocks reach the registry as data", () => {
    test("every block is listed under its kind and project, with each type named by its panel and no code", async () => {
        const listed = await blocksApi.list(PANEL);
        const byEntry = Object.fromEntries(listed.map((b) => [b.entry, b]));
        expect(Object.keys(byEntry).sort()).toEqual([
            "s1/command.create-world",
            "s1/command.join",
            "s1/command.kick",
            "s1/command.leave",
            "s1/command.lie",
            "s1/command.misfire",
            "s1/command.warp",
            "s1/event.joined",
            "s1/event.left",
            "s1/value.kicks",
            "s1/value.online",
            "type.player",
        ]);
        expect(byEntry["s1/command.kick"]!.project).toBe("s1");
        expect(byEntry["type.player"]!.project).toBeUndefined();
        expect(byEntry["s1/command.kick"]!.schema).toEqual({
            kind: "command",
            id: "kick",
            name: "Kick Player",
            text: "Kick {player} because {reason}",
            inputs: {
                player: { type: `${PANEL}:player`, name: "Player" },
                reason: { type: "text", name: "Reason", optional: true, maxLength: 20 },
            },
            output: "number",
            outputName: "Kicks",
        });
        expect(byEntry["s1/value.online"]!.schema).toEqual({ kind: "value", id: "online", name: "Online Players", type: `list<${PANEL}:player>`, changes: true });
        expect(byEntry["type.player"]!.schema).toEqual({
            kind: "type",
            id: "player",
            name: "Player",
            base: "object",
            fields: {
                name: { type: "text", name: "Name" },
                shout: { type: "text", name: "Shout", resolved: true },
                nickname: { type: "text", name: "Nickname", optional: true },
                online: { type: "boolean", name: "Online", perProject: true, resolved: true },
            },
        });
        // choices worked out on demand say so, without the code; a default is listed as is
        expect(byEntry["s1/command.warp"]!.schema).toMatchObject({
            inputs: { world: { type: "text", name: "World", dynamicChoices: true }, times: { type: "number", name: "Times", default: 1, min: 1 } },
        });
        expect(await blocksApi.projects(PANEL)).toEqual([{ panelId: PANEL, id: "s1", name: "Survival", icon: "dns" }]);
    });

    test("blocks are their own registry: Actions lists none of them", async () => {
        expect(await actionsApi.list(PANEL)).toEqual([]);
    });
});

describe("commands and values run in their panel, checked at its boundary", () => {
    test("a command runs with valid inputs and returns its typed result", async () => {
        const before = await read("kicks");
        expect(await run("kick", { player: { name: "Steve" }, reason: "griefing" })).toBe((before as number) + 1);
        expect(await run("kick", { player: { name: "Alex" } })).toBe((before as number) + 2);
    });

    test("inputs that are missing, mistyped, too long or unknown are refused before run, naming the input", async () => {
        const before = await read("kicks");
        await expect(run("kick", {})).rejects.toThrow('Kick Player: "Player" is required');
        await expect(run("kick", { player: "Steve" })).rejects.toThrow('Kick Player: "Player": expected an object');
        await expect(run("kick", { player: { name: 3 } })).rejects.toThrow('"Player": the field "name": expected text');
        await expect(run("kick", { player: { name: "S" }, reason: "x".repeat(21) })).rejects.toThrow('"Reason" must be at most 20 characters');
        await expect(run("kick", { player: { name: "S" }, why: "x" })).rejects.toThrow('there is no input "why"');
        expect(await read("kicks")).toBe(before);
    });

    test("an input left out takes its default, and is still checked", async () => {
        expect(await run("warp", { world: "world" })).toBe("world x1");
        expect(await run("warp", { world: "world", times: 3 })).toBe("world x3");
        await expect(run("warp", { world: "world", times: 0 })).rejects.toThrow('"Times" must be at least 1');
    });

    test("choices worked out on demand follow the panel, and a choice that's gone is refused by name", async () => {
        const warp = "s1/command.warp";
        expect(await blocksApi.choices(PANEL, warp, "world")).toEqual([{ label: "world", value: "world" }]);
        await expect(run("warp", { world: "nether" })).rejects.toThrow('Warp: "World" must be one of world');
        await run("create-world", { world: "nether" });
        expect(await blocksApi.choices(PANEL, warp, "world")).toEqual([
            { label: "world", value: "world" },
            { label: "nether", value: "nether" },
        ]);
        expect(await run("warp", { world: "nether" })).toBe("nether x1");
        await expect(blocksApi.choices(PANEL, warp, "times")).rejects.toThrow('Warp input "Times" has no choices');
    });

    test("a command that returns something other than its declared type fails loudly instead of handing it on", async () => {
        await expect(run("lie")).rejects.toThrow('Lie returned: expected a number, got the text "not a number"');
    });

    test("a block of a project that doesn't exist, or a kind that isn't runnable, is refused", async () => {
        await expect(blocksApi.run(PANEL, "kick", {}, { project: "nope" })).rejects.toThrow("is not registered or unavailable");
        await expect(blocksApi.run(PANEL, "kick")).rejects.toThrow("is not registered or unavailable");
    });
});

describe("properties read a field off the value, or ask its panel", () => {
    test("a stored field comes off the value and a resolved field is answered by the panel", async () => {
        expect(await blocksApi.property(`${PANEL}:player`, "name", { name: "Steve" })).toBe("Steve");
        expect(await blocksApi.property(`${PANEL}:player`, "shout", { name: "Steve" })).toBe("STEVE!");
    });

    test("an optional field a value doesn't have reads as nothing", async () => {
        expect(await blocksApi.property(`${PANEL}:player`, "nickname", { name: "Steve" })).toBeNull();
        expect(await blocksApi.property(`${PANEL}:player`, "nickname", { name: "Steve", nickname: "Stevie" })).toBe("Stevie");
        await expect(blocksApi.property(`${PANEL}:player`, "nickname", { name: "Steve", nickname: 4 })).rejects.toThrow('the field "nickname": expected text');
    });

    test("a per-project field is looked up in the project that asks, and refuses without one", async () => {
        await run("join", { name: "Herobrine" });
        expect(await blocksApi.property(`${PANEL}:player`, "online", { name: "Herobrine" }, { project: "s1" })).toBe(true);
        expect(await blocksApi.property(`${PANEL}:player`, "online", { name: "Notch" }, { project: "s1" })).toBe(false);
        await expect(blocksApi.property(`${PANEL}:player`, "online", { name: "Herobrine" })).rejects.toThrow("Online of Player is read in a project: say which one");
        await expect(blocksApi.property(`${PANEL}:player`, "online", { name: "Herobrine" }, { project: "s9" })).rejects.toThrow('there is no project "s9"');
    });

    test("an unknown field, or a value that isn't the type, is refused", async () => {
        await expect(blocksApi.property(`${PANEL}:player`, "age", { name: "Steve" })).rejects.toThrow('Player has no field "age"');
        await expect(blocksApi.property(`${PANEL}:player`, "shout", "Steve")).rejects.toThrow("Player: expected an object");
    });
});

describe("events and changes reach whoever listens", () => {
    test("firing an event delivers its payload, and a changed value is read fresh", async () => {
        const fired: unknown[] = [];
        let changes = 0;
        const offEvent = blocksApi.onEvent(PANEL, "joined", (payload) => fired.push(payload), "s1");
        const offChange = blocksApi.onChange(PANEL, "online", () => changes++, "s1");
        try {
            // a subscription is announced to the daemon on its own: wait
            // until a firing lands before counting
            const deadline = Date.now() + 10_000;
            while (fired.length === 0) {
                if (Date.now() > deadline) throw new Error("the event never arrived");
                await run("join", { name: "Steve" });
                await sleep(100);
            }
            const firstChanges = changes;
            fired.length = 0;
            await run("join", { name: "Alex" });
            while (fired.length === 0 || changes === firstChanges) {
                if (Date.now() > deadline) throw new Error("the second firing never arrived");
                await sleep(20);
            }
            expect(fired).toEqual([{ player: { name: "Alex" } }]);
            // the value read after the change holds the player who just joined
            expect(((await read("online")) as unknown[]).at(-1)).toEqual({ name: "Alex" });
        } finally {
            offEvent();
            offChange();
        }
    });

    test("an optional value may be left out of a firing", async () => {
        expect(await run("leave", { name: "Steve" })).toBeNull();
    });

    test("a payload the event doesn't declare is refused in the panel before anything is sent", async () => {
        expect(await run("misfire")).toEqual([
            'When a Player Joins value "player": the field "name": expected text, got number 7',
            'When a Player Joins does not fire a value "extra"',
            'When a Player Joins value "player": expected a value, got nothing',
        ]);
    });
});

describe("a broken definition is refused before it reaches the registry", () => {
    const refuse = (set: BlockSet) => () => validateBlockDefinitions(set, PANEL);
    const run = () => null;

    test("text must show each input exactly once and name nothing else", () => {
        expect(refuse({ commands: [{ id: "a", name: "A", text: "Do {it}", run }] })).toThrow('Command "a" text names {it}, which is not one of its inputs');
        expect(refuse({ commands: [{ id: "a", name: "A", text: "Do", inputs: { it: { type: "text", name: "It" } }, run }] })).toThrow("text must show {it} once, not 0 times");
    });

    test("what a command gives back is named where its type doesn't name it", () => {
        expect(refuse({ commands: [{ id: "a", name: "A", output: "text", run }] })).toThrow('Command "a" gives back text, so it needs an outputName that says what that is');
        expect(refuse({ commands: [{ id: "a", name: "A", outputName: "Answer", run }] })).toThrow('Command "a" has an outputName but no output');
        expect(() => validateBlockDefinitions({ commands: [{ id: "a", name: "A", output: "text", outputName: "Answer", run }] }, PANEL)).not.toThrow();
        expect(() => validateBlockDefinitions({ commands: [{ id: "a", name: "A", output: "dev.other:ghost", run }] }, PANEL)).not.toThrow();
    });

    test("every custom type named must be defined by the panel, or be another panel's", () => {
        expect(refuse({ values: [{ id: "a", name: "A", type: "list<ghost>", read: run }] })).toThrow('Value "a" type: the type "ghost" is not defined by this panel');
        expect(() => validateBlockDefinitions({ values: [{ id: "a", name: "A", type: "dev.other:ghost", read: run }] }, PANEL)).not.toThrow();
        expect(refuse({ values: [{ id: "a", name: "A", type: "lisst<text>", read: run }] })).toThrow('"lisst<text>" is not a type');
    });

    test("a field on a value with no keys needs a resolver, and limits must fit the input", () => {
        expect(refuse({ types: [{ id: "t", name: "T", base: "text", fields: { len: { type: "number", name: "Length" } } }] })).toThrow('Type "t" field "len" has nothing to read');
        expect(refuse({ commands: [{ id: "a", name: "A", inputs: { n: { type: "text", name: "N", min: 1 } }, run }] })).toThrow('input "n" limits a number, but takes text');
        expect(refuse({ commands: [{ id: "a", name: "A", inputs: { n: { type: "number", name: "N", min: 5, max: 1 } }, run }] })).toThrow("declares a min above its max");
    });

    test("an event filter compares an input with a value it fires, of the same type", () => {
        const base = { id: "e", name: "E", values: { who: { type: "text", name: "Who" } } };
        expect(refuse({ events: [{ ...base, inputs: { who: { type: "number", name: "Who" } }, filters: { who: "who" } }] })).toThrow("they must be one type");
        expect(refuse({ events: [{ ...base, inputs: { who: { type: "text", name: "Who" } }, filters: { who: "nobody" } }] })).toThrow('which it does not fire');
    });

    test("a default must fit its input, and a per-project field needs resolve", () => {
        expect(refuse({ commands: [{ id: "a", name: "A", inputs: { n: { type: "number", name: "N", default: "x" } }, run }] })).toThrow('input "n" default: "N": expected a number');
        expect(refuse({ commands: [{ id: "a", name: "A", inputs: { n: { type: "number", name: "N", max: 3, default: 9 } }, run }] })).toThrow('"N" must be at most 3');
        expect(refuse({ commands: [{ id: "a", name: "A", inputs: { n: { type: "text", name: "N", choices: [{ label: "B", value: "b" }], default: "c" } }, run }] })).toThrow('"N" must be one of B');
        expect(refuse({ types: [{ id: "t", name: "T", base: "object", fields: { x: { type: "text", name: "X", perProject: true } } }] })).toThrow("needs resolve to look it up in the project");
    });

    test("ids are unique per kind", () => {
        expect(refuse({ commands: [{ id: "a", name: "A", run }, { id: "a", name: "B", run }] })).toThrow('Command "a" is defined twice');
    });

    test("types belong to the panel: a project can't register one", async () => {
        const project = await blocksApi.defineProject({ id: "host-side", name: "Host side" }, "dev.test.host");
        await expect(project.register({ types: [{ id: "t", name: "T", base: "object" }] })).rejects.toThrow('Types belong to the panel, not project "host-side"');
        await project.remove();
    });
});

describe("a panel's categories head its sections", () => {
    const refuse = (set: BlockSet) => () => validateBlockDefinitions(set, PANEL);
    const run = () => null;
    test("a block in a declared category is listed with its symbol, in the panel's projects too; only the panel declares them", async () => {
        const memory = memoryBlocks("dev.test.categories");
        await memory.panel.register({
            categories: [{ name: "Players", icon: "group" }],
            commands: [{ id: "list", name: "List", category: "Players", run }],
        });
        const server = await memory.defineProject({ id: "s1", name: "Survival" });
        await server.register({
            commands: [{ id: "kick", name: "Kick", category: "Players", run }],
            values: [{ id: "count", name: "Count", category: "Other", type: "number", read: () => 1 }],
        });
        const schemaOf = (entry: string) => memory.list().find((b) => b.entry === entry)!.schema as { category?: string; categoryIcon?: string };
        expect(schemaOf("command.list")).toMatchObject({ category: "Players", categoryIcon: "group" });
        expect(schemaOf("s1/command.kick")).toMatchObject({ category: "Players", categoryIcon: "group" });
        // a category nobody declared has no symbol
        expect(schemaOf("s1/value.count").categoryIcon).toBeUndefined();
        await expect(server.register({ categories: [{ name: "Chat", icon: "chat" }] })).rejects.toThrow('Categories belong to the panel, not project "s1"');
        expect(refuse({ categories: [{ name: "A", icon: "x" }, { name: "A", icon: "y" }] })).toThrow('Category "A" is defined twice');
        expect(refuse({ categories: [{ name: "A" } as never] })).toThrow('Category "A" icon');
    });
});

describe("values are checked against their type", () => {
    const lookup = () => undefined;
    test("core types check their JSON shape, lists every item", () => {
        expect(valueProblem("timestamp", Date.now(), lookup)).toBeNull();
        expect(valueProblem("color", "#33ff66", lookup)).toBeNull();
        expect(valueProblem("color", "red", lookup)).toContain("expected a color");
        expect(valueProblem("url", "https://paperboard.dev", lookup)).toBeNull();
        expect(valueProblem("url", "not a url", lookup)).toContain("expected a web address");
        expect(valueProblem("list<number>", [1, 2, "3"], lookup)).toBe('item 3: expected a number, got the text "3"');
        expect(valueProblem("list<list<boolean>>", [[true], [false]], lookup)).toBeNull();
    });
});

describe("a registry in memory checks what the daemon's does, for a panel's tests", () => {
    test("blocks run through the same checks, a firing is heard once checked, and only JSON crosses", async () => {
        const fired: unknown[] = [];
        const changed: string[] = [];
        const memory = memoryBlocks("dev.test.memory", { fired: (event, payload, project) => fired.push([event, payload, project]), changed: (value) => changed.push(value) });
        await memory.panel.register({
            types: [{ id: "player", name: "Player", base: "text", fields: { online: { type: "boolean", name: "Online", perProject: true, resolve: (_name, ctx) => ctx.project === "s1" } } }],
        });
        const server = await memory.defineProject({ id: "s1", name: "Survival" });
        await server.register({
            commands: [
                { id: "greet", name: "Greet", inputs: { who: { type: "player", name: "Who" }, times: { type: "number", name: "Times", default: 2 } }, output: "text", outputName: "Greeting", run: ({ who, times }) => `${who} x${times}` },
                { id: "when", name: "When", output: "any", outputName: "Time", run: () => ({ at: new Date(0) }) },
            ],
            values: [{ id: "count", name: "Count", type: "number", changes: true, read: () => 1 }],
            events: [{ id: "left", name: "Left", values: { who: { type: "player", name: "Who" }, reason: { type: "text", name: "Reason", optional: true } } }],
        });
        expect(memory.list().map((b) => b.entry).sort()).toEqual(["s1/command.greet", "s1/command.when", "s1/event.left", "s1/value.count", "type.player"]);
        expect(await memory.run("greet", { who: "alex" }, { project: "s1" })).toBe("alex x2");
        await expect(memory.run("greet", {}, { project: "s1" })).rejects.toThrow('Greet: "Who" is required');
        // a Date isn't JSON: it arrives as the text the wire would carry
        expect(await memory.run("when", {}, { project: "s1" })).toEqual({ at: "1970-01-01T00:00:00.000Z" });
        expect(await memory.property("player", "online", "alex", { project: "s1" })).toBe(true);
        await expect(memory.property("player", "online", "alex")).rejects.toThrow("is read in a project");
        await server.fire("left", { who: "alex" });
        await expect(server.fire("left", { who: 4 } as never)).rejects.toThrow('Left value "who": expected text');
        await server.changed("count");
        expect(fired).toEqual([["left", { who: "alex" }, "s1"]]);
        expect(changed).toEqual(["count"]);
    });
    test("a type lists its values, in a project when asked in one, so an input of it starts as a dropdown", async () => {
        const memory = memoryBlocks("dev.test.choices");
        const online: Record<string, string[]> = { s1: ["alex", "sam"] };
        await memory.panel.register({
            types: [
                { id: "player", name: "Player", base: "text", choices: (ctx) => (online[ctx.project ?? ""] ?? Object.values(online).flat()).map((p) => ({ label: p, value: p })) },
                { id: "kit", name: "Kit", base: "text" },
            ],
        });
        await memory.defineProject({ id: "s1", name: "Survival" });
        expect(memory.list().find((b) => b.entry === "type.player")!.schema).toMatchObject({ dynamicChoices: true });
        expect(memory.list().find((b) => b.entry === "type.kit")!.schema).not.toHaveProperty("dynamicChoices");
        expect(await memory.typeChoices("player", { project: "s1" })).toEqual([{ label: "alex", value: "alex" }, { label: "sam", value: "sam" }]);
        expect(await memory.typeChoices("player")).toHaveLength(2);
        await expect(memory.typeChoices("player", { project: "s9" })).rejects.toThrow('Player: there is no project "s9"');
        await expect(memory.typeChoices("kit")).rejects.toThrow("Kit doesn't list its values");
        expect(() => validateBlockDefinitions({ types: [{ id: "a", name: "A", base: "text", choices: [] as never }] }, "dev.test.choices")).toThrow("choices must be a function");
    });
});
