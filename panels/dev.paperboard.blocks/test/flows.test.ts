// The contract between the editor and the service: what Blockly saves for
// this panel's block definitions is what the interpreter runs. Every
// workspace here goes through a real (headless) Blockly load and save, so
// the shapes are Blockly's own, not hand-written ones. The registry's side
// (blocksApi.run/read through the daemon) is covered in PaperAPI's
// blocks.test.ts; here the host records what a flow asked of it.
import { beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { block, find, num, saved, steps, text, top, type Json } from "./helpers/workspace";
import type { BlockInfo } from "@mileniumhq/paperapi";
import { BUILTIN_BLOCKS, registryDefinitions } from "../src/lib/blockDefs";
import { readFlows } from "../src/lib/flows";
import { registerChoicesField } from "../src/lib/choicesField";
import { BlockError, MAX_LOOP_ITERATIONS, hatInputs, runHat, type Host } from "../src/lib/interpreter";
import { BUILTIN, choiceBlockType, propertyBlockType, registryBlockType } from "../src/lib/names";

const GAME = "dev.test.game";
const PLAYER = `${GAME}:player`;
const TEAM = `${GAME}:team`;

const ENTRIES: BlockInfo[] = [
    { panelId: GAME, entry: "type.player", schema: { kind: "type", id: "player", name: "Player", base: "text", fields: { name: { type: "text", name: "Name", resolved: true } } } },
    {
        panelId: GAME,
        entry: "s1/command.kick",
        project: "s1",
        schema: {
            kind: "command",
            id: "kick",
            name: "Kick Player",
            text: "Kick {player} because {reason} {how}",
            inputs: {
                player: { type: PLAYER, name: "Player" },
                reason: { type: "text", name: "Reason" },
                how: { type: "any", name: "How", choices: [{ label: "Softly", value: "soft" }, { label: "With a ban", value: { ban: true } }] },
            },
        },
    },
    { panelId: GAME, entry: "s1/command.count-kicks", project: "s1", schema: { kind: "command", id: "count-kicks", name: "Count Kicks", output: "number", outputName: "Kicks" } },
    { panelId: GAME, entry: "type.team", schema: { kind: "type", id: "team", name: "Team", base: "text", dynamicChoices: true } },
    {
        panelId: GAME,
        entry: "s1/command.join",
        project: "s1",
        schema: { kind: "command", id: "join", name: "Join", text: "Join {team} or {backup}", inputs: { team: { type: TEAM, name: "Team" }, backup: { type: TEAM, name: "Backup", optional: true } } },
    },
    { panelId: GAME, entry: "s1/command.pick", project: "s1", schema: { kind: "command", id: "pick", name: "Pick a Player", output: PLAYER } },
    { panelId: GAME, entry: "s1/value.online", project: "s1", schema: { kind: "value", id: "online", name: "Online Players", type: `list<${PLAYER}>`, changes: true } },
    { panelId: GAME, entry: "s1/value.count", project: "s1", schema: { kind: "value", id: "count", name: "Player Count", type: "number" } },
    { panelId: GAME, entry: "s1/event.joined", project: "s1", schema: { kind: "event", id: "joined", name: "Player Joined", values: { player: { type: PLAYER, name: "Player" } } } },
] as BlockInfo[];

const KICK = registryBlockType({ kind: "command", panelId: GAME, entry: "s1/command.kick" });
const COUNT_KICKS = registryBlockType({ kind: "command", panelId: GAME, entry: "s1/command.count-kicks" });
const KICKS = registryBlockType({ kind: "result", panelId: GAME, entry: "s1/command.count-kicks" });
const PICK = registryBlockType({ kind: "command", panelId: GAME, entry: "s1/command.pick" });
const PICKED = registryBlockType({ kind: "result", panelId: GAME, entry: "s1/command.pick" });
const PICKED_NAME = registryBlockType({ kind: "result", panelId: GAME, entry: "s1/command.pick", key: "name", typeRef: PLAYER });
const ONLINE = registryBlockType({ kind: "value", panelId: GAME, entry: "s1/value.online" });
const COUNT = registryBlockType({ kind: "value", panelId: GAME, entry: "s1/value.count" });
const JOINED = registryBlockType({ kind: "event", panelId: GAME, entry: "s1/event.joined" });
const JOINED_PLAYER = registryBlockType({ kind: "event-value", panelId: GAME, entry: "s1/event.joined", key: "player" });
const PLAYER_FIELD = propertyBlockType(PLAYER);
const KICK_HOW = registryBlockType({ kind: "choices", panelId: GAME, entry: "s1/command.kick", key: "how" });
const JOIN = registryBlockType({ kind: "command", panelId: GAME, entry: "s1/command.join" });

beforeAll(() => {
    // the dropdowns' choices aren't asked for here: a saved choice stands as it was saved
    registerChoicesField({ fetch: async () => [], report: (message) => { throw new Error(message); } });
    Blockly.common.defineBlocksWithJsonArray([...BUILTIN_BLOCKS, ...registryDefinitions(ENTRIES).blocks]);
});


interface Recorded {
    host: Host;
    calls: { panelId: string; entry: string; inputs: Record<string, unknown> }[];
    logs: string[];
    stop(): void;
}

function recorder(answers: { read?: Record<string, unknown>; run?: (entry: string, inputs: Record<string, unknown>) => unknown } = {}): Recorded {
    const controller = new AbortController();
    const calls: Recorded["calls"] = [];
    const logs: string[] = [];
    return {
        calls,
        logs,
        stop: () => controller.abort(),
        host: {
            signal: controller.signal,
            run: async (panelId, entry, inputs) => {
                calls.push({ panelId, entry, inputs });
                return answers.run ? answers.run(entry, inputs) : null;
            },
            read: async (panelId, entry, inputs) => {
                calls.push({ panelId, entry, inputs });
                if (!answers.read || !(entry in answers.read)) throw new Error(`nothing to read for ${entry}`);
                return answers.read[entry];
            },
            // a Player is its name; its Name field is looked up by the panel
            property: async (typeRef, field, value) => {
                calls.push({ panelId: typeRef, entry: field, inputs: { value } });
                return field === "name" ? String(value).toUpperCase() : undefined;
            },
            log: (message) => {
                logs.push(message);
            },
        },
    };
}


describe("a flow the editor saved runs the way it reads", () => {
    test("a command gets its typed inputs and its dropdown's value, and Log writes what it's given", async () => {
        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: {
                    DO: steps(
                        { type: KICK, inputs: { player: text("alice"), reason: text("griefing"), how: { shadow: { type: KICK_HOW, fields: { VALUE: JSON.stringify({ ban: true }) } } } } },
                        {
                            type: BUILTIN.log,
                            inputs: {
                                TEXT: block("text_join", {
                                    extraState: { itemCount: 2 },
                                    inputs: { ADD0: text("players: "), ADD1: block(COUNT) },
                                }),
                            },
                        },
                    ),
                },
            },
        ]);
        const r = recorder({ read: { "s1/value.count": 3 } });
        await runHat(top(ws, BUILTIN.onRun), null, ws, r.host);
        expect(r.calls).toEqual([
            { panelId: GAME, entry: "s1/command.kick", inputs: { how: { ban: true }, player: "alice", reason: "griefing" } },
            { panelId: GAME, entry: "s1/value.count", inputs: {} },
        ]);
        expect(r.logs).toEqual(["players: 3"]);
    });

    test("a loop over a list value reads each item's field, and Break leaves it", async () => {
        const ws = saved(
            [
                {
                    type: BUILTIN.onRun,
                    inputs: {
                        DO: steps(
                            { type: "variables_set", fields: { VAR: { id: "seen" } }, inputs: { VALUE: num(0) } },
                            {
                                type: "controls_forEach",
                                fields: { VAR: { id: "p" } },
                                inputs: {
                                    LIST: block(ONLINE),
                                    DO: steps(
                                        {
                                            type: "controls_if",
                                            inputs: {
                                                IF0: block("logic_compare", {
                                                    fields: { OP: "EQ" },
                                                    inputs: { A: block(PLAYER_FIELD, { fields: { FIELD: "name" }, inputs: { VALUE: block("variables_get", { fields: { VAR: { id: "p" } } }) } }), B: text("CAROL") },
                                                }),
                                                DO0: steps({ type: "controls_flow_statements", fields: { FLOW: "BREAK" } }),
                                            },
                                        },
                                        { type: "math_change", fields: { VAR: { id: "seen" } }, inputs: { DELTA: num(1) } },
                                    ),
                                },
                            },
                            { type: BUILTIN.log, inputs: { TEXT: block("variables_get", { fields: { VAR: { id: "seen" } } }) } },
                        ),
                    },
                },
            ],
            [
                { name: "seen", id: "seen" },
                { name: "p", id: "p" },
            ],
        );
        const r = recorder({ read: { "s1/value.online": ["alice", "bob", "carol", "dave"] } });
        await runHat(top(ws, BUILTIN.onRun), null, ws, r.host);
        expect(r.logs).toEqual(["2"]);
    });

    test("a command that gives something back is a step, and its gear's blocks read what that block gave", async () => {
        const defs = registryDefinitions(ENTRIES);
        expect(defs.results[COUNT_KICKS]).toEqual([KICKS]);
        expect(defs.results[PICK]).toEqual([PICKED, PICKED_NAME]);
        expect(defs.blocks.find((b) => b.type === PICKED_NAME)!.message0).toBe("player name");
        expect(defs.blocks.find((b) => b.type === KICKS)!.message0).toBe("kicks");

        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: {
                    DO: steps(
                        { type: COUNT_KICKS, id: "count" },
                        { type: BUILTIN.log, inputs: { TEXT: block(KICKS, { extraState: { from: "count" } }) } },
                        { type: PICK, id: "pick" },
                        { type: BUILTIN.log, inputs: { TEXT: block(PICKED_NAME, { extraState: { from: "pick" } }) } },
                        { type: PICK, id: "again" },
                        { type: BUILTIN.log, inputs: { TEXT: block(PICKED, { extraState: { from: "pick" } }) } },
                    ),
                },
            },
        ]);
        let picks = 0;
        const r = recorder({ run: (entry) => (entry === "s1/command.count-kicks" ? 5 : entry === "s1/command.pick" ? ["erin", "finn"][picks++] : null) });
        await runHat(top(ws, BUILTIN.onRun), null, ws, r.host);
        // each reads its own block's result: "again" picked finn, but the last log reads "pick"
        expect(r.logs).toEqual(["5", "ERIN", "erin"]);
    });

    test("an input of a type that lists its values starts as a dropdown of them, which a text block can replace", async () => {
        const defs = registryDefinitions(ENTRIES);
        const join = defs.sections.flatMap((s) => s.contents).find((b) => b.type === JOIN)!;
        expect(join.inputs).toEqual({ team: { shadow: { type: choiceBlockType(TEAM) } }, backup: { shadow: { type: choiceBlockType(TEAM, "none") } } });

        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: {
                    DO: steps(
                        { type: JOIN, inputs: { team: { shadow: { type: choiceBlockType(TEAM), fields: { VALUE: '"red"' } } }, backup: { shadow: { type: choiceBlockType(TEAM, "none"), fields: { VALUE: "null" } } } } },
                        { type: JOIN, inputs: { team: { shadow: { type: choiceBlockType(TEAM), fields: { VALUE: '"red"' } }, block: { type: "text", fields: { TEXT: "blue" } } } } },
                    ),
                },
            },
        ]);
        const r = recorder();
        await runHat(top(ws, BUILTIN.onRun), null, ws, r.host);
        // "none" leaves the input out; a text block put over the dropdown is what runs
        expect(r.calls.map((c) => c.inputs)).toEqual([{ team: "red" }, { team: "blue" }]);
    });

    test("a command's result is empty until its block runs", async () => {
        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: { DO: steps({ type: BUILTIN.log, inputs: { TEXT: block(KICKS, { id: "early", extraState: { from: "count" } }) } }, { type: COUNT_KICKS, id: "count" }) },
            },
        ]);
        const r = recorder({ run: () => 5 });
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, r.host).catch((e) => e);
        expect(err).toBeInstanceOf(BlockError);
        expect(err.message).toBe('This value is empty until its "count-kicks" block runs');
        expect(err.blockId).toBe("early");
        expect(r.calls).toEqual([]);
    });

    test("an event's own values only exist inside its hat", async () => {
        const ws = saved([
            {
                type: JOINED,
                inputs: { DO: steps({ type: BUILTIN.log, inputs: { TEXT: block(PLAYER_FIELD, { fields: { FIELD: "name" }, inputs: { VALUE: block(JOINED_PLAYER) } }) } }) },
            },
            { type: BUILTIN.onRun, inputs: { DO: steps({ type: BUILTIN.log, inputs: { TEXT: block(JOINED_PLAYER) } }) } },
        ]);
        const r = recorder();
        await runHat(top(ws, JOINED), { player: "erin" }, ws, r.host);
        expect(r.logs).toEqual(["ERIN"]);

        const outside = runHat(top(ws, BUILTIN.onRun), null, ws, r.host);
        await expect(outside).rejects.toThrow('This value only exists inside "joined" blocks');
        const second = ws.blocks!.blocks[1]!;
        await outside.catch((err: BlockError) => expect(err.blockId).toBe(second.inputs!.DO!.block!.inputs!.TEXT!.block!.id));
    });

    test("an event hat's own inputs are worked out without running its steps", async () => {
        const ws = saved([{ type: JOINED, inputs: { DO: steps({ type: KICK, inputs: { player: text("x"), reason: text("y") } }) } }]);
        const r = recorder();
        expect(await hatInputs(top(ws, JOINED), ws, r.host)).toEqual({});
        expect(r.calls).toEqual([]);
    });
});

describe("a failing flow stops and names the block it failed on", () => {
    test("a command the owning panel refuses fails on that block, and the steps after it don't run", async () => {
        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: { DO: steps({ type: KICK, inputs: { player: text("bob"), reason: text(""), how: { shadow: { type: KICK_HOW, fields: { VALUE: '"soft"' } } } } }, { type: BUILTIN.log, inputs: { TEXT: text("after") } }) },
            },
        ]);
        const r = recorder({
            run: () => {
                throw new Error('Kick Player: "Reason" is required');
            },
        });
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, r.host).catch((e) => e);
        expect(err).toBeInstanceOf(BlockError);
        expect(err.message).toBe('Kick Player: "Reason" is required');
        expect(err.blockId).toBe(find(ws, KICK).id);
        expect(r.logs).toEqual([]);
    });

    test("a value the owning panel can't read fails on that value, not on the step that used it", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: BUILTIN.log, inputs: { TEXT: block(COUNT) } }) } }]);
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, recorder().host).catch((e) => e);
        expect(err.message).toBe("nothing to read for s1/value.count");
        expect(err.blockId).toBe(find(ws, COUNT).id);
    });

    test("dividing by zero, or arithmetic on a variable holding text, fails on the arithmetic block", async () => {
        // Blockly keeps text out of a number socket; a variable can still carry it there
        const arithmetic = (b: Json) =>
            saved(
                [
                    {
                        type: BUILTIN.onRun,
                        inputs: {
                            DO: steps(
                                { type: "variables_set", fields: { VAR: { id: "x" } }, inputs: { VALUE: text("two") } },
                                { type: BUILTIN.log, inputs: { TEXT: block("math_arithmetic", { fields: { OP: "DIVIDE" }, inputs: { A: num(1), B: b } }) } },
                            ),
                        },
                    },
                ],
                [{ name: "x", id: "x" }],
            );
        for (const [ws, message] of [
            [arithmetic(num(0)), "Can't divide by zero"],
            [arithmetic(block("variables_get", { fields: { VAR: { id: "x" } } })), 'The second number must be a number, not the text "two"'],
        ] as const) {
            const err = await runHat(top(ws, BUILTIN.onRun), null, ws, recorder().host).catch((e) => e);
            expect(err.message).toBe(message);
            expect(err.blockId).toBe(find(ws, "math_arithmetic").id);
        }
    });

    test("a loop that never ends is stopped after its limit", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: "controls_whileUntil", fields: { MODE: "WHILE" }, inputs: { BOOL: block("logic_boolean", { fields: { BOOL: "TRUE" } }) } }) } }]);
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, recorder().host).catch((e) => e);
        expect(err.message).toBe(`This loop went round ${MAX_LOOP_ITERATIONS} times, so the run stopped it`);
        expect(err.blockId).toBe(find(ws, "controls_whileUntil").id);
    });

    test("Stop ends a run that is waiting, right away", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: BUILTIN.wait, inputs: { SECONDS: num(600) } }, { type: BUILTIN.log, inputs: { TEXT: text("too late") } }) } }]);
        const r = recorder();
        const started = Date.now();
        const run = runHat(top(ws, BUILTIN.onRun), null, ws, r.host).catch((e) => e);
        setTimeout(() => r.stop(), 50);
        const err = await run;
        expect(err.message).toBe("The run was stopped");
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(r.logs).toEqual([]);
    });
});

describe("saved flows are checked before they're kept or run", () => {
    test("a workspace Blockly saved, with its block schemas, reads back as it was", () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: KICK, inputs: { player: text("a"), reason: text("b") } }) } }]);
        const schemas = { [KICK]: { panelId: GAME, entry: "s1/command.kick", schema: ENTRIES[1]!.schema } };
        const flows = JSON.parse(JSON.stringify({ workspace: ws, schemas }));
        expect(readFlows(flows)).toEqual({ workspace: ws, schemas } as never);
    });

    test("a broken save is refused with its reason", () => {
        const ok = saved([{ type: BUILTIN.onRun }]);
        expect(() => readFlows(null)).toThrow("The saved flows are not an object");
        expect(() => readFlows({ schemas: {} })).toThrow("The saved flows have no workspace");
        expect(() => readFlows({ workspace: { blocks: { blocks: {} } }, schemas: {} })).toThrow("The saved workspace's blocks are not a list");
        expect(() => readFlows({ workspace: { blocks: { blocks: [{ type: BUILTIN.onRun }] } }, schemas: {} })).toThrow("A saved block has no type or id");
        expect(() => readFlows({ workspace: ok })).toThrow("The saved flows have no block schemas");
        expect(() => readFlows({ workspace: ok, schemas: { [KICK]: { panelId: GAME } } })).toThrow(`The saved schema for "${KICK}" is broken`);
    });
});
