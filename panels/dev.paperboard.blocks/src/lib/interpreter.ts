// Runs a flow: walks the blocks Blockly saved (its JSON serialization) and
// does what they say. Blocks from the registry run in the panel that owns
// them, through `host`; built-in blocks run here. Nothing is generated or
// evaluated as code. Every failure names the block it happened on.
import { BUILTIN, parseEntry, parsePropertyBlockType, parseRegistryBlockType } from "./names";

export interface SavedInput {
    block?: SavedBlock;
    shadow?: SavedBlock;
}

export interface SavedBlock {
    type: string;
    id: string;
    x?: number;
    y?: number;
    enabled?: boolean;
    fields?: Record<string, unknown>;
    inputs?: Record<string, SavedInput>;
    next?: SavedInput;
    extraState?: unknown;
}

export interface SavedWorkspace {
    blocks?: { languageVersion: number; blocks: SavedBlock[] };
    variables?: { name: string; id: string; type?: string }[];
}

/** What the interpreter asks of the outside world. */
export interface Host {
    run(panelId: string, entry: string, inputs: Record<string, unknown>): Promise<unknown>;
    read(panelId: string, entry: string, inputs: Record<string, unknown>): Promise<unknown>;
    property(typeRef: string, field: string, value: unknown): Promise<unknown>;
    log(message: string, blockId: string): void;
    /** aborted when the run is stopped */
    signal: AbortSignal;
}

/** A failure inside a flow, and the block it happened on. */
export class BlockError extends Error {
    constructor(message: string, readonly blockId: string) {
        super(message);
        this.name = "BlockError";
    }
}

class Break {}
class Continue {}

/** The hat blocks a flow can start from: the run hat and the registry's. */
export function isHat(type: string): boolean {
    if (type === BUILTIN.onRun) return true;
    const name = parseRegistryBlockType(type);
    return name?.kind === "event" || name?.kind === "changes";
}

/** A loop may go round this many times before the run stops it. */
export const MAX_LOOP_ITERATIONS = 100_000;
/** The longest a Wait block waits, in seconds. */
export const MAX_WAIT_SECONDS = 24 * 60 * 60;

interface Run {
    host: Host;
    hat: SavedBlock;
    payload: Record<string, unknown> | null;
    variables: Map<string, unknown>;
    names: Map<string, string>;
}

/** Runs a hat's steps, with what its event fired. Rejects with a BlockError. */
export async function runHat(hat: SavedBlock, payload: Record<string, unknown> | null, workspace: SavedWorkspace, host: Host): Promise<void> {
    if (!isHat(hat.type)) throw new BlockError(`"${hat.type}" is not a block a flow starts from`, hat.id);
    const run: Run = {
        host,
        hat,
        payload,
        variables: new Map(),
        names: new Map((workspace.variables ?? []).map((v) => [v.id, v.name])),
    };
    try {
        await chain(run, hat.inputs?.DO?.block);
    } catch (err) {
        if (err instanceof Break || err instanceof Continue) throw new BlockError("Break and Continue only work inside a loop", hat.id);
        throw err;
    }
}

/** The literal and computed values of a hat's own inputs (an event's filters), outside any run. */
export async function hatInputs(hat: SavedBlock, workspace: SavedWorkspace, host: Host): Promise<Record<string, unknown>> {
    const run: Run = { host, hat, payload: null, variables: new Map(), names: new Map((workspace.variables ?? []).map((v) => [v.id, v.name])) };
    return gatherInputs(run, hat, ["DO"]);
}

const blockOf = (input: SavedInput | undefined) => input?.block ?? input?.shadow;

async function chain(run: Run, first: SavedBlock | undefined): Promise<void> {
    for (let block = first; block; block = block.next?.block) {
        if (run.host.signal.aborted) throw new BlockError("The run was stopped", block.id);
        if (block.enabled === false) continue;
        await statement(run, block);
    }
}

function fail(block: SavedBlock, err: unknown): never {
    if (err instanceof BlockError || err instanceof Break || err instanceof Continue) throw err;
    throw new BlockError(err instanceof Error ? err.message : String(err), block.id);
}

function field(block: SavedBlock, name: string): unknown {
    return block.fields?.[name];
}

function variableId(block: SavedBlock): string {
    const v = field(block, "VAR") as { id?: string } | undefined;
    if (!v?.id) throw new BlockError("This block names no variable", block.id);
    return v.id;
}

async function value(run: Run, block: SavedBlock, name: string): Promise<unknown> {
    const target = blockOf(block.inputs?.[name]);
    if (!target) return undefined;
    if (target.enabled === false) throw new BlockError("This block is turned off", target.id);
    return evaluate(run, target);
}

async function required(run: Run, block: SavedBlock, name: string, what: string): Promise<unknown> {
    const v = await value(run, block, name);
    if (v === undefined || v === null) throw new BlockError(`${what} is empty`, block.id);
    return v;
}

async function numberOf(run: Run, block: SavedBlock, name: string, what: string): Promise<number> {
    const v = await required(run, block, name, what);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new BlockError(`${what} must be a number, not ${describe(v)}`, block.id);
    return v;
}

async function booleanOf(run: Run, block: SavedBlock, name: string, what: string): Promise<boolean> {
    const v = await required(run, block, name, what);
    if (typeof v !== "boolean") throw new BlockError(`${what} must be true or false, not ${describe(v)}`, block.id);
    return v;
}

async function listOf(run: Run, block: SavedBlock, name: string, what: string): Promise<unknown[]> {
    const v = await required(run, block, name, what);
    if (!Array.isArray(v)) throw new BlockError(`${what} must be a list, not ${describe(v)}`, block.id);
    return v;
}

/** Text as a person reads it: lists and objects as JSON. */
export function asText(v: unknown): string {
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
}

function describe(v: unknown): string {
    if (v === undefined || v === null) return "nothing";
    if (Array.isArray(v)) return "a list";
    if (typeof v === "string") return `the text "${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
    if (typeof v === "object") return "an object";
    return String(v);
}

function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

async function gatherInputs(run: Run, block: SavedBlock, skip: string[] = []): Promise<Record<string, unknown>> {
    const inputs: Record<string, unknown> = {};
    // a registry block's fields are its dropdowns, each value JSON (Blockly keeps only text)
    for (const [key, v] of Object.entries(block.fields ?? {})) {
        try {
            inputs[key] = JSON.parse(String(v));
        } catch (err) {
            throw new BlockError(`The choice for "${key}" can't be read (${err instanceof Error ? err.message : String(err)}): ${String(v)}`, block.id);
        }
    }
    for (const key of Object.keys(block.inputs ?? {})) {
        if (skip.includes(key)) continue;
        const v = await value(run, block, key);
        if (v !== undefined && v !== null) inputs[key] = v;
    }
    return inputs;
}

async function loop(run: Run, block: SavedBlock, round: () => Promise<boolean>): Promise<void> {
    for (let i = 0; ; i++) {
        if (i >= MAX_LOOP_ITERATIONS) throw new BlockError(`This loop went round ${MAX_LOOP_ITERATIONS} times, so the run stopped it`, block.id);
        if (run.host.signal.aborted) throw new BlockError("The run was stopped", block.id);
        // a long loop leaves room for the rest of the service between rounds
        if (i % 1000 === 999) await new Promise((resolve) => setTimeout(resolve, 0));
        if (!(await round())) return;
    }
}

async function body(run: Run, block: SavedBlock): Promise<"break" | "next"> {
    try {
        await chain(run, block.inputs?.DO?.block);
        return "next";
    } catch (err) {
        if (err instanceof Break) return "break";
        if (err instanceof Continue) return "next";
        throw err;
    }
}

async function statement(run: Run, block: SavedBlock): Promise<void> {
    try {
        switch (block.type) {
            case "controls_if": {
                const state = (block.extraState ?? {}) as { elseIfCount?: number; hasElse?: boolean };
                for (let i = 0; i <= (state.elseIfCount ?? 0); i++) {
                    if (await booleanOf(run, block, `IF${i}`, "The condition")) {
                        await chain(run, block.inputs?.[`DO${i}`]?.block);
                        return;
                    }
                }
                if (state.hasElse) await chain(run, block.inputs?.ELSE?.block);
                return;
            }
            case "controls_repeat_ext": {
                const times = await numberOf(run, block, "TIMES", "The number of times");
                let i = 0;
                return loop(run, block, async () => i++ < times && (await body(run, block)) === "next");
            }
            case "controls_whileUntil": {
                const until = field(block, "MODE") === "UNTIL";
                return loop(run, block, async () => (await booleanOf(run, block, "BOOL", "The condition")) !== until && (await body(run, block)) === "next");
            }
            case "controls_forEach": {
                const list = await listOf(run, block, "LIST", "The list");
                const id = variableId(block);
                let i = 0;
                return loop(run, block, async () => {
                    if (i >= list.length) return false;
                    run.variables.set(id, list[i++]);
                    return (await body(run, block)) === "next";
                });
            }
            case "controls_flow_statements":
                throw field(block, "FLOW") === "BREAK" ? new Break() : new Continue();
            case "variables_set":
                run.variables.set(variableId(block), await value(run, block, "VALUE"));
                return;
            case "math_change": {
                const id = variableId(block);
                const current = run.variables.get(id);
                const delta = await numberOf(run, block, "DELTA", "The change");
                if (current !== undefined && (typeof current !== "number" || !Number.isFinite(current))) {
                    throw new BlockError(`${run.names.get(id) ?? "The variable"} holds ${describe(current)}, not a number`, block.id);
                }
                run.variables.set(id, ((current as number | undefined) ?? 0) + delta);
                return;
            }
            case BUILTIN.wait: {
                const seconds = await numberOf(run, block, "SECONDS", "The wait");
                if (seconds < 0 || seconds > MAX_WAIT_SECONDS) throw new BlockError(`A wait is between 0 and ${MAX_WAIT_SECONDS} seconds`, block.id);
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(done, seconds * 1000);
                    function done() {
                        run.host.signal.removeEventListener("abort", stop);
                        resolve();
                    }
                    function stop() {
                        clearTimeout(timer);
                        reject(new BlockError("The run was stopped", block.id));
                    }
                    run.host.signal.addEventListener("abort", stop, { once: true });
                });
                return;
            }
            case BUILTIN.log:
                run.host.log(asText(await value(run, block, "TEXT")), block.id);
                return;
        }
        const name = parseRegistryBlockType(block.type);
        if (name?.kind === "command") {
            await run.host.run(name.panelId, name.entry, await gatherInputs(run, block));
            return;
        }
        throw new BlockError(`"${block.type}" can't be a step`, block.id);
    } catch (err) {
        fail(block, err);
    }
}

async function evaluate(run: Run, block: SavedBlock): Promise<unknown> {
    try {
        switch (block.type) {
            case "logic_boolean":
                return field(block, "BOOL") === "TRUE";
            case "logic_negate":
                return !(await booleanOf(run, block, "BOOL", "The value"));
            case "logic_operation": {
                const and = field(block, "OP") === "AND";
                const a = await booleanOf(run, block, "A", "The first value");
                if (and ? !a : a) return a;
                return booleanOf(run, block, "B", "The second value");
            }
            case "logic_compare": {
                const a = await value(run, block, "A");
                const b = await value(run, block, "B");
                const op = field(block, "OP");
                if (op === "EQ") return equal(a, b);
                if (op === "NEQ") return !equal(a, b);
                const comparable = (v: unknown) => typeof v === "number" || typeof v === "string";
                if (!comparable(a) || !comparable(b) || typeof a !== typeof b) {
                    throw new BlockError(`Only two numbers or two texts can be compared that way, not ${describe(a)} and ${describe(b)}`, block.id);
                }
                const [x, y] = [a as number | string, b as number | string];
                return op === "LT" ? x < y : op === "LTE" ? x <= y : op === "GT" ? x > y : x >= y;
            }
            case "math_number":
                return Number(field(block, "NUM"));
            case "math_arithmetic": {
                const a = await numberOf(run, block, "A", "The first number");
                const b = await numberOf(run, block, "B", "The second number");
                switch (field(block, "OP")) {
                    case "ADD":
                        return a + b;
                    case "MINUS":
                        return a - b;
                    case "MULTIPLY":
                        return a * b;
                    case "DIVIDE":
                        if (b === 0) throw new BlockError("Can't divide by zero", block.id);
                        return a / b;
                    case "POWER":
                        return a ** b;
                }
                throw new BlockError(`Unknown arithmetic ${String(field(block, "OP"))}`, block.id);
            }
            case "text":
                return String(field(block, "TEXT") ?? "");
            case "text_join": {
                const count = ((block.extraState ?? {}) as { itemCount?: number }).itemCount ?? 0;
                let out = "";
                for (let i = 0; i < count; i++) out += asText(await value(run, block, `ADD${i}`));
                return out;
            }
            case "text_length":
                return asText(await value(run, block, "VALUE")).length;
            case "text_isEmpty":
                return asText(await value(run, block, "VALUE")).length === 0;
            case "lists_create_with": {
                const count = ((block.extraState ?? {}) as { itemCount?: number }).itemCount ?? 0;
                const list: unknown[] = [];
                for (let i = 0; i < count; i++) {
                    const v = await value(run, block, `ADD${i}`);
                    if (v !== undefined) list.push(v);
                }
                return list;
            }
            case "lists_length":
                return (await listOf(run, block, "VALUE", "The list")).length;
            case "lists_isEmpty":
                return (await listOf(run, block, "VALUE", "The list")).length === 0;
            case "variables_get": {
                const id = variableId(block);
                if (!run.variables.has(id)) throw new BlockError(`${run.names.get(id) ?? "This variable"} has no value yet`, block.id);
                return run.variables.get(id);
            }
        }
        const typeRef = parsePropertyBlockType(block.type);
        if (typeRef) {
            const fieldName = field(block, "FIELD");
            if (typeof fieldName !== "string") throw new BlockError("Pick a field", block.id);
            return run.host.property(typeRef, fieldName, await required(run, block, "VALUE", "The value"));
        }
        const name = parseRegistryBlockType(block.type);
        if (name?.kind === "value") return run.host.read(name.panelId, name.entry, await gatherInputs(run, block));
        if (name?.kind === "command") return run.host.run(name.panelId, name.entry, await gatherInputs(run, block));
        if (name?.kind === "event-value") {
            const running = parseRegistryBlockType(run.hat.type);
            if (running?.kind !== "event" || running.panelId !== name.panelId || running.entry !== name.entry) {
                throw new BlockError(`This value only exists inside "${parseEntry(name.entry).id}" blocks`, block.id);
            }
            return run.payload?.[name.key!];
        }
        throw new BlockError(`"${block.type}" can't be a value`, block.id);
    } catch (err) {
        fail(block, err);
    }
}
