// What a panel declares beyond a plain block: defaults, choices worked out
// on demand, fields read in a project, and values a firing may leave out.
// Each goes through a real (headless) Blockly load and save, and through
// the interpreter, so what the editor shows is what runs.
import { beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import type { BlockInfo } from "@mileniumhq/paperapi";
import { BUILTIN_BLOCKS, choicesSources, PROPERTIES_CATEGORY, registryDefinitions } from "../src/lib/blockDefs";
import { refreshChoices, registerChoicesField } from "../src/lib/choicesField";
import { runHat, type Host } from "../src/lib/interpreter";
import { BUILTIN, propertyBlockType, registryBlockType } from "../src/lib/names";
import { block, saved, steps, text, top } from "./helpers/workspace";

const GAME = "dev.test.extras";
const PLAYER = `${GAME}:player`;

const ENTRIES = [
    {
        panelId: GAME,
        entry: "type.player",
        schema: {
            kind: "type",
            id: "player",
            name: "Player",
            base: "text",
            fields: { name: { type: "text", name: "Name", resolved: true }, online: { type: "boolean", name: "Online", resolved: true, perProject: true } },
        },
    },
    { panelId: GAME, entry: "type.world", schema: { kind: "type", id: "world", name: "World", base: "object", fields: { name: { type: "text", name: "Name" } } } },
    {
        panelId: GAME,
        entry: "s1/command.warp",
        project: "s1",
        schema: {
            kind: "command",
            id: "warp",
            name: "Warp",
            text: "Warp to {world} {times} times, {mode}",
            inputs: {
                world: { type: "text", name: "World", dynamicChoices: true },
                times: { type: "number", name: "Times", default: 3 },
                mode: { type: "text", name: "Mode", default: "fast", choices: [{ label: "Slow", value: "slow" }, { label: "Fast", value: "fast" }] },
            },
        },
    },
    {
        panelId: GAME,
        entry: "s1/event.left",
        project: "s1",
        schema: { kind: "event", id: "left", name: "Player Left", values: { player: { type: PLAYER, name: "Player" }, reason: { type: "text", name: "Reason", optional: true } } },
    },
] as BlockInfo[];
const PROJECTS = [
    { panelId: GAME, id: "s1", name: "Survival" },
    { panelId: GAME, id: "s2", name: "Creative" },
];

const WARP = registryBlockType({ kind: "command", panelId: GAME, entry: "s1/command.warp" });
const WARP_WORLD = registryBlockType({ kind: "choices", panelId: GAME, entry: "s1/command.warp", key: "world" });
const WARP_MODE = registryBlockType({ kind: "choices", panelId: GAME, entry: "s1/command.warp", key: "mode" });
const pick = (type: string, value: string) => ({ shadow: { type, fields: { VALUE: value } } });
const LEFT = registryBlockType({ kind: "event", panelId: GAME, entry: "s1/event.left" });
const LEFT_REASON = registryBlockType({ kind: "event-value", panelId: GAME, entry: "s1/event.left", key: "reason" });

let worlds = [{ label: "Overworld", value: "world" }];
const defs = registryDefinitions(ENTRIES, PROJECTS);

beforeAll(() => {
    registerChoicesField({ fetch: async () => worlds, report: (message) => { throw new Error(message); } });
    // the built-ins may already be defined by another test file
    Blockly.common.defineBlocksWithJsonArray([...BUILTIN_BLOCKS.filter((b) => !Blockly.Blocks[b.type as string]), ...defs.blocks]);
});

function host(calls: unknown[][], logs: string[]): Host {
    return {
        signal: new AbortController().signal,
        run: async (panelId, entry, inputs) => void calls.push(["run", entry, inputs]),
        read: async () => null,
        property: async (typeRef, field, value, project) => {
            calls.push(["property", typeRef, field, value, project]);
            return field === "online" ? true : String(value);
        },
        log: (message) => void logs.push(message),
    };
}

describe("defaults", () => {
    test("a new block starts on each input's default: its socket's block, or its dropdown's choice", () => {
        const warp = defs.sections.flatMap((s) => s.contents).find((b) => b.type === WARP)!;
        expect(warp).toEqual({
            kind: "block",
            type: WARP,
            inputs: { times: { shadow: { type: "math_number", fields: { NUM: 3 } } }, world: { shadow: { type: WARP_WORLD } }, mode: pick(WARP_MODE, '"fast"') },
        });
        const ws = new Blockly.Workspace();
        try {
            const { kind: _kind, ...state } = warp;
            const created = Blockly.serialization.blocks.append(state as Blockly.serialization.blocks.State, ws);
            expect(created.getInputTargetBlock("mode")!.getFieldValue("VALUE")).toBe('"fast"');
        } finally {
            ws.dispose();
        }
    });
});

describe("choices worked out on demand", () => {
    test("the dropdown offers what the panel answers, and a saved choice it no longer offers stays as saved", async () => {
        expect(choicesSources(ENTRIES)).toEqual([{ panelId: GAME, entry: "s1/command.warp", input: "world" }]);
        await refreshChoices(choicesSources(ENTRIES)[0]!);
        const ws = new Blockly.Workspace();
        try {
            const world = Blockly.serialization.blocks.append({ type: WARP_WORLD, fields: { VALUE: '"world"' } }, ws);
            const field = world.getField("VALUE") as Blockly.FieldDropdown;
            expect(field.getOptions(false)).toEqual([["Overworld", '"world"']]);
            // the panel lost the world: a flow that picked it keeps it, and running says it's gone
            worlds = [{ label: "Nether", value: "nether" }];
            await refreshChoices(choicesSources(ENTRIES)[0]!);
            const kept = Blockly.serialization.blocks.append({ type: WARP_WORLD, fields: { VALUE: '"world"' } }, ws);
            expect(kept.getFieldValue("VALUE")).toBe('"world"');
            expect((kept.getField("VALUE") as Blockly.FieldDropdown).getOptions(false)).toEqual([["Nether", '"nether"'], ["world", '"world"']]);
        } finally {
            ws.dispose();
        }
    });

    test("the run gets the choice as its value; an input with no block is left for the panel to default", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: WARP, inputs: { world: pick(WARP_WORLD, '"nether"'), mode: pick(WARP_MODE, '"slow"') } }) } }]);
        const calls: unknown[][] = [];
        await runHat(top(ws, BUILTIN.onRun), null, ws, host(calls, []));
        expect(calls).toEqual([["run", "s1/command.warp", { world: "nether", mode: "slow" }]]);
    });

    test("a variable put over a dropdown is what runs, as in any other input", async () => {
        const ws = saved(
            [
                {
                    type: BUILTIN.onRun,
                    inputs: {
                        DO: steps(
                            { type: "variables_set", fields: { VAR: { id: "w" } }, inputs: { VALUE: text("end") } },
                            { type: WARP, inputs: { world: { ...pick(WARP_WORLD, '"world"'), block: { type: "variables_get", fields: { VAR: { id: "w" } } } } } },
                        ),
                    },
                },
            ],
            [{ name: "w", id: "w" }],
        );
        const calls: unknown[][] = [];
        await runHat(top(ws, BUILTIN.onRun), null, ws, host(calls, []));
        expect(calls).toEqual([["run", "s1/command.warp", { world: "end" }]]);
    });
});

describe("fields read in a project", () => {
    test("each project gets its own property block for them; the panel's keeps the rest, named by type", () => {
        const panelBlock = defs.blocks.find((b) => b.type === propertyBlockType(PLAYER))!;
        expect(panelBlock.message0).toBe("%1 of Player %2");
        expect((panelBlock.args0 as { options?: unknown }[])[0]!.options).toEqual([["Name", "name"]]);
        for (const project of ["s1", "s2"]) {
            const projectBlock = defs.blocks.find((b) => b.type === propertyBlockType(PLAYER, project))!;
            expect((projectBlock.args0 as { options?: unknown }[])[0]!.options).toEqual([["Online", "online"]]);
            expect(defs.sections.find((s) => s.project === project && s.category === PROPERTIES_CATEGORY)!.contents).toContainEqual({ kind: "block", type: propertyBlockType(PLAYER, project) });
        }
        // a type with no per-project field gets no project blocks
        expect(defs.blocks.some((b) => String(b.type).startsWith(`${propertyBlockType(`${GAME}:world`)}|`))).toBe(false);
    });

    test("the run asks in the block's project", async () => {
        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: {
                    DO: steps({ type: BUILTIN.log, inputs: { TEXT: block(propertyBlockType(PLAYER, "s2"), { fields: { FIELD: "online" }, inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "alex" } } } } }) } }),
                },
            },
        ]);
        const calls: unknown[][] = [];
        const logs: string[] = [];
        await runHat(top(ws, BUILTIN.onRun), null, ws, host(calls, logs));
        expect(calls).toEqual([["property", PLAYER, "online", "alex", "s2"]]);
        expect(logs).toEqual(["true"]);
    });
});

describe("values a firing may leave out", () => {
    test("a left-out value is nothing, and \"has a value\" tells it apart", async () => {
        const ws = saved([
            {
                type: LEFT,
                inputs: {
                    DO: steps({
                        type: "controls_if",
                        extraState: { hasElse: true },
                        inputs: {
                            IF0: block(BUILTIN.hasValue, { inputs: { VALUE: block(LEFT_REASON) } }),
                            DO0: steps({ type: BUILTIN.log, inputs: { TEXT: block(LEFT_REASON) } }),
                            ELSE: steps({ type: BUILTIN.log, inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "no reason" } } } } }),
                        },
                    }),
                },
            },
        ]);
        const logs: string[] = [];
        await runHat(top(ws, LEFT), { player: "alex" }, ws, host([], logs));
        await runHat(top(ws, LEFT), { player: "alex", reason: null }, ws, host([], logs));
        await runHat(top(ws, LEFT), { player: "alex", reason: "afk" }, ws, host([], logs));
        expect(logs).toEqual(["no reason", "no reason", "afk"]);
    });
});
