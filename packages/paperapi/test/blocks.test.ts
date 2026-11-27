import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi, memoryBlocks, validateBlockDefinitions, valueProblem } from "../src/blocks";
import { closeTransport, getTransport } from "../src/ipc";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

setDefaultTimeout(60_000);

const PANEL = "dev.test.blocks";
let daemon: Daemon;
let panel: PanelProcess;

beforeAll(async () => {
    daemon = await startDaemon();
    panel = await daemon.startPanel(PANEL, "blocks");
});

afterAll(async () => {
    await panel.stop();
    closeTransport();
    await daemon.stop();
});

// the caller is this test process (the host), as the Blocks panel will be:
// every block runs in the panel's own process, through the daemon
const run = (command: string, inputs?: Record<string, unknown>) => blocksApi.run(PANEL, command, inputs, { project: "s1" });
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
});

describe("templates are data a panel registers on its own handle", () => {
    const template = { id: "restart", name: "Restart nightly", description: "Restarts the server at 04:00", icon: "restart_alt", when: { everyDay: "04:00" }, steps: [{ command: "restart" }] };
    const refused = (templates: unknown[], types: string[] = []) => () =>
        validateBlockDefinitions({ templates: templates as never, types: types.map((id) => ({ id, name: id, base: "text" as const })) }, "dev.test.templates");

    test("the daemon lists a panel's templates as they were defined, and never as blocks", async () => {
        expect(await blocksApi.templates(PANEL)).toEqual([
            {
                panelId: PANEL,
                template: {
                    id: "say-who-joined",
                    name: "Say who joined",
                    description: "Logs each player who joins a server",
                    icon: "waving_hand",
                    eachProject: true,
                    when: { event: "joined" },
                    steps: [{ log: "Someone joined {project}" }],
                },
            },
        ]);
        expect((await blocksApi.list(PANEL)).some((b) => b.entry.includes("template."))).toBe(false);
    });

    test("a template that can't be made is refused where it's defined, naming what is wrong", () => {
        expect(refused([template, { ...template, needs: "server" }], ["server"])).toThrow('Template "restart" is defined twice');
        expect(refused([{ ...template, when: {} }])).toThrow('Template "restart" needs when: { event } or { everyDay }');
        expect(refused([{ ...template, when: { everyDay: "4am" } }])).toThrow("which isn't a time of day as 04:00");
        expect(refused([{ ...template, when: { event: "joined", everyDay: "04:00" } }])).toThrow("needs when: { event } or { everyDay }");
        expect(refused([{ ...template, steps: [] }])).toThrow("needs at least one step");
        expect(refused([{ ...template, steps: [{ command: "restart", log: "both" }] }])).toThrow("step 1 must be { command } or { log }");
        expect(refused([{ ...template, steps: [{ command: "restart", inputs: { server: {} } }] }])).toThrow('input "server" must start as text, a number or true/false');
        expect(refused([{ ...template, steps: [{ log: "{project} restarted" }] }])).toThrow("logs {project}, but the template isn't made for each project");
        expect(refused([{ ...template, needs: "server" }])).toThrow('needs "server", which is not a type this panel defines');
        expect(refused([{ ...template, description: "" }])).toThrow('Template "restart" needs a description');
        expect(refused([{ ...template, needs: "server" }], ["server"])).not.toThrow();
    });

    test("only the panel's own handle registers them; a project's is refused", async () => {
        const memory = memoryBlocks("dev.test.templates");
        const server = await memory.defineProject({ id: "s1", name: "Survival" });
        await expect(server.register({ templates: [template] })).rejects.toThrow('Templates belong to the panel, not project "s1"');
        await memory.panel.register({ commands: [{ id: "restart", name: "Restart", run: () => undefined }], templates: [template] });
        expect(memory.templates()).toEqual([{ panelId: "dev.test.templates", template }]);
        expect(memory.list().map((b) => b.entry)).toEqual(["command.restart"]);
        await expect(memory.panel.unregister("template", "restart")).resolves.toBeUndefined();
        expect(memory.templates()).toEqual([]);
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
        // wakes whoever waits for the next firing or change
        let heard = () => {};
        const until = async (check: () => boolean) => {
            while (!check()) await new Promise<void>((resolve) => (heard = resolve));
        };
        const offEvent = blocksApi.onEvent(PANEL, "joined", (payload) => {
            fired.push(payload);
            heard();
        }, "s1");
        const offChange = blocksApi.onChange(PANEL, "online", () => {
            changes++;
            heard();
        }, "s1");
        try {
            await getTransport().subscriptionsSettled();
            await run("join", { name: "Alex" });
            await until(() => fired.length === 1 && changes === 1);
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
        // listed values follow the rule declared ones do: no value offered twice
        online.s1 = ["alex", "alex"];
        await expect(memory.typeChoices("player", { project: "s1" })).rejects.toThrow('Player offers the value "alex" twice');
        expect(() => validateBlockDefinitions({ types: [{ id: "a", name: "A", base: "text", choices: [] as never }] }, "dev.test.choices")).toThrow("choices must be a function");
    });
});
