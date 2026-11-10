import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsApi } from "../src/actions";
import { blocksApi, validateBlockDefinitions, valueProblem, type BlockSet } from "../src/blocks";
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
            "s1/command.join",
            "s1/command.kick",
            "s1/command.lie",
            "s1/command.misfire",
            "s1/event.joined",
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
        });
        expect(byEntry["s1/value.online"]!.schema).toEqual({ kind: "value", id: "online", name: "Online Players", type: `list<${PANEL}:player>`, changes: true });
        expect(byEntry["type.player"]!.schema).toEqual({
            kind: "type",
            id: "player",
            name: "Player",
            base: "object",
            fields: { name: { type: "text", name: "Name" }, shout: { type: "text", name: "Shout", resolved: true } },
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

    test("ids are unique per kind", () => {
        expect(refuse({ commands: [{ id: "a", name: "A", run }, { id: "a", name: "B", run }] })).toThrow('Command "a" is defined twice');
    });

    test("types belong to the panel: a project can't register one", async () => {
        const project = await blocksApi.defineProject({ id: "host-side", name: "Host side" }, "dev.test.host");
        await expect(project.register({ types: [{ id: "t", name: "T", base: "object" }] })).rejects.toThrow('Types belong to the panel, not project "host-side"');
        await project.remove();
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
