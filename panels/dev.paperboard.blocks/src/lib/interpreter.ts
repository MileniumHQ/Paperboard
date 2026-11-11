// Runs a flow: walks the blocks Blockly saved (its JSON serialization) and
// does what they say. Blocks from the registry run in the panel that owns
// them, through `host`; built-in blocks run here. Nothing is generated or
// evaluated as code. Every failure names the block it happened on.
import { base64, formatTime, isPrime, median, modes, position, regex, standardDeviation, timePart, unitMs, web, type WebAnswer } from "./library";
import { BUILTIN, parseChoiceBlockType, parseEntry, parsePropertyBlockType, parseRegistryBlockType } from "./names";

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
    /** a per-project field is read in its project */
    property(typeRef: string, field: string, value: unknown, project?: string): Promise<unknown>;
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
/** "Stop this flow": ends the run quietly, past any loop or try */
class Stop {}
/** "return" inside a function: ends the call with this value */
class Return {
    constructor(readonly value: unknown) {}
}

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
/** How often "Wait until" checks its condition, in milliseconds. */
export const WAIT_UNTIL_POLL_MS = 500;
/** How deep functions may call functions (a function calling itself) before the run stops. */
export const MAX_CALL_DEPTH = 1000;

interface Run {
    host: Host;
    hat: SavedBlock;
    payload: Record<string, unknown> | null;
    variables: Map<string, unknown>;
    names: Map<string, string>;
    /** the failures being handled, innermost last ("if it fails" parts) */
    errors: string[];
    /** the workspace's functions, by name as Blockly compares them (any case) */
    functions: Map<string, SavedBlock>;
    /** the function being run, if any: whether it gives back a value */
    calling: { returns: boolean } | null;
    depth: number;
    /** what each command block gave back, the last time it ran in this run */
    results: Map<string, unknown>;
}

const FUNCTION_DEFINITIONS = new Set(["procedures_defnoreturn", "procedures_defreturn"]);

/** The functions a workspace defines; one that's turned off isn't there. */
function functionsOf(workspace: SavedWorkspace): Map<string, SavedBlock> {
    const out = new Map<string, SavedBlock>();
    for (const b of workspace.blocks?.blocks ?? []) {
        const name = b.fields?.NAME;
        if (FUNCTION_DEFINITIONS.has(b.type) && b.enabled !== false && typeof name === "string") out.set(name.toLowerCase(), b);
    }
    return out;
}

function newRun(hat: SavedBlock, payload: Record<string, unknown> | null, workspace: SavedWorkspace, host: Host): Run {
    return {
        host,
        hat,
        payload,
        variables: new Map(),
        names: new Map((workspace.variables ?? []).map((v) => [v.id, v.name])),
        errors: [],
        functions: functionsOf(workspace),
        calling: null,
        depth: 0,
        results: new Map(),
    };
}

/** Runs a hat's steps, with what its event fired. Rejects with a BlockError. */
export async function runHat(hat: SavedBlock, payload: Record<string, unknown> | null, workspace: SavedWorkspace, host: Host): Promise<void> {
    if (!isHat(hat.type)) throw new BlockError(`"${hat.type}" is not a block a flow starts from`, hat.id);
    const run = newRun(hat, payload, workspace, host);
    try {
        await chain(run, hat.inputs?.DO?.block);
    } catch (err) {
        if (err instanceof Stop) return;
        if (err instanceof Break || err instanceof Continue) throw new BlockError("Break and Continue only work inside a loop", hat.id);
        throw err;
    }
}

/** The literal and computed values of a hat's own inputs (an event's filters), outside any run. */
export async function hatInputs(hat: SavedBlock, workspace: SavedWorkspace, host: Host): Promise<Record<string, unknown>> {
    const run = newRun(hat, null, workspace, host);
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
    if (err instanceof BlockError || err instanceof Break || err instanceof Continue || err instanceof Stop || err instanceof Return) throw err;
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

async function textOf(run: Run, block: SavedBlock, name: string): Promise<string> {
    return asText(await value(run, block, name));
}

function numbersIn(block: SavedBlock, list: unknown[]): number[] {
    for (const item of list) {
        if (typeof item !== "number" || !Number.isFinite(item)) throw new BlockError(`Every item must be a number, not ${describe(item)}`, block.id);
    }
    return list as number[];
}

function finite(block: SavedBlock, n: number): number {
    if (!Number.isFinite(n)) throw new BlockError("The answer isn't a number", block.id);
    return n;
}

/** The position a block's WHERE (and AT, when it has one) points at. */
async function positionOf(run: Run, block: SavedBlock, where: string, atInput: string, length: number, what: string): Promise<number> {
    const at = where === "FROM_START" || where === "FROM_END" ? await numberOf(run, block, atInput, "The position") : undefined;
    return position(where, at, length, what);
}

/** The slice a block's WHERE1/AT1 and WHERE2/AT2 cover: start, and end (exclusive). */
async function rangeOf(run: Run, block: SavedBlock, length: number, what: string): Promise<[number, number]> {
    const where1 = String(field(block, "WHERE1"));
    const where2 = String(field(block, "WHERE2"));
    const start = where1 === "FIRST" ? 0 : await positionOf(run, block, where1, "AT1", length, what);
    const end = where2 === "LAST" ? length : (await positionOf(run, block, where2, "AT2", length, what)) + 1;
    return [start, Math.max(start, end)];
}

/** Takes an item out of a list (Blockly's "in list get/remove"). */
async function listItem(run: Run, block: SavedBlock, remove: boolean): Promise<unknown> {
    const list = await listOf(run, block, "VALUE", "The list");
    const i = await positionOf(run, block, String(field(block, "WHERE")), "AT", list.length, "list");
    const item = list[i];
    if (remove) list.splice(i, 1);
    return item;
}

/** Waits, ending early (and failing the run) when it is stopped. */
function pause(run: Run, block: SavedBlock, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (run.host.signal.aborted) return reject(new BlockError("The run was stopped", block.id));
        const timer = setTimeout(done, ms);
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

/**
 * Calls a function: its inputs are worked out here, then its parameters
 * hold them while its steps run, and hold what they held before afterwards.
 * Gives back what it returns (null when it returns nothing).
 */
async function call(run: Run, block: SavedBlock): Promise<unknown> {
    const name = (block.extraState as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || !name) throw new BlockError("This block calls no function", block.id);
    const definition = run.functions.get(name.toLowerCase());
    if (!definition) throw new BlockError(`There's no function called "${name}"`, block.id);
    if (run.depth >= MAX_CALL_DEPTH) throw new BlockError(`Functions called each other ${MAX_CALL_DEPTH} deep, so the run stopped`, block.id);
    const params = ((definition.extraState as { params?: { id: string }[] } | undefined)?.params ?? []).map((p) => p.id);
    const args: unknown[] = [];
    for (let i = 0; i < params.length; i++) args.push(await value(run, block, `ARG${i}`));

    const before = params.map((id) => ({ id, had: run.variables.has(id), value: run.variables.get(id) }));
    params.forEach((id, i) => {
        // an empty input leaves the parameter empty, so reading it says so
        if (args[i] === undefined) run.variables.delete(id);
        else run.variables.set(id, args[i]);
    });
    const outer = run.calling;
    const returns = definition.type === "procedures_defreturn";
    run.calling = { returns };
    run.depth++;
    try {
        try {
            await chain(run, definition.inputs?.STACK?.block);
        } catch (err) {
            if (err instanceof Return) return err.value ?? null;
            if (err instanceof Break || err instanceof Continue) throw new BlockError("Break and Continue only work inside a loop", definition.id);
            throw err;
        }
        return returns ? ((await value(run, definition, "RETURN")) ?? null) : null;
    } finally {
        run.depth--;
        run.calling = outer;
        for (const b of before) {
            if (b.had) run.variables.set(b.id, b.value);
            else run.variables.delete(b.id);
        }
    }
}

/** Pins any failure, awaited or returned, on this block. */
async function statement(run: Run, block: SavedBlock): Promise<void> {
    try {
        return await statementOf(run, block);
    } catch (err) {
        fail(block, err);
    }
}

async function statementOf(run: Run, block: SavedBlock): Promise<void> {
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
        case "procedures_callnoreturn":
            await call(run, block);
            return;
        case "procedures_ifreturn": {
            if (!run.calling) throw new BlockError("Return only works inside a function", block.id);
            if (await booleanOf(run, block, "CONDITION", "The condition")) throw new Return(run.calling.returns ? ((await value(run, block, "VALUE")) ?? null) : undefined);
            return;
        }
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
            await pause(run, block, seconds * 1000);
            return;
        }
        case BUILTIN.waitUntil: {
            const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;
            while (!(await booleanOf(run, block, "BOOL", "The condition"))) {
                if (Date.now() >= deadline) throw new BlockError(`The condition didn't come true within ${MAX_WAIT_SECONDS / 3600} hours`, block.id);
                await pause(run, block, WAIT_UNTIL_POLL_MS);
            }
            return;
        }
        case BUILTIN.stop:
            throw new Stop();
        case BUILTIN.fail: {
            const message = await textOf(run, block, "MESSAGE");
            throw new BlockError(message || "The flow failed", block.id);
        }
        case BUILTIN.attempt: {
            try {
                await chain(run, block.inputs?.DO?.block);
            } catch (err) {
                // stopping, and leaving a loop, a function or the flow, aren't failures to handle
                if (err instanceof Break || err instanceof Continue || err instanceof Stop || err instanceof Return || run.host.signal.aborted) throw err;
                run.errors.push(err instanceof Error ? err.message : String(err));
                try {
                    await chain(run, block.inputs?.CATCH?.block);
                } finally {
                    run.errors.pop();
                }
            }
            return;
        }
        case "lists_getIndex":
            if (field(block, "MODE") !== "REMOVE") throw new BlockError("Only \"remove\" can be a step; get the item into a variable instead", block.id);
            await listItem(run, block, true);
            return;
        case "lists_setIndex": {
            const list = await listOf(run, block, "LIST", "The list");
            const where = String(field(block, "WHERE"));
            const item = await value(run, block, "TO");
            if (field(block, "MODE") === "INSERT") {
                if (where === "LAST") list.push(item);
                else if (where === "FIRST") list.unshift(item);
                else list.splice(await positionOf(run, block, where, "AT", list.length, "list"), 0, item);
            } else {
                list[await positionOf(run, block, where, "AT", list.length, "list")] = item;
            }
            return;
        }
        case BUILTIN.log:
            run.host.log(asText(await value(run, block, "TEXT")), block.id);
            return;
    }
    const name = parseRegistryBlockType(block.type);
    if (name?.kind === "command") {
        const result = await run.host.run(name.panelId, name.entry, await gatherInputs(run, block));
        run.results.set(block.id, result ?? null);
        return;
    }
    throw new BlockError(`"${block.type}" can't be a step`, block.id);
}

/** Pins any failure, awaited or returned, on this block. */
async function evaluate(run: Run, block: SavedBlock): Promise<unknown> {
    try {
        return await evaluateOf(run, block);
    } catch (err) {
        fail(block, err);
    }
}

async function evaluateOf(run: Run, block: SavedBlock): Promise<unknown> {
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
        case "logic_ternary":
            return (await booleanOf(run, block, "IF", "The condition")) ? value(run, block, "THEN") : value(run, block, "ELSE");
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
        case "math_single": {
            const n = await numberOf(run, block, "NUM", "The number");
            const op = field(block, "OP");
            if (op === "ROOT" && n < 0) throw new BlockError("A negative number has no square root", block.id);
            if ((op === "LN" || op === "LOG10") && n <= 0) throw new BlockError("Only a positive number has a logarithm", block.id);
            const ops: Record<string, (x: number) => number> = { ROOT: Math.sqrt, ABS: Math.abs, NEG: (x) => -x, LN: Math.log, LOG10: Math.log10, EXP: Math.exp, POW10: (x) => 10 ** x };
            const fn = ops[String(op)];
            if (!fn) throw new BlockError(`Unknown operation ${String(op)}`, block.id);
            return finite(block, fn(n));
        }
        case "math_round": {
            const n = await numberOf(run, block, "NUM", "The number");
            const op = field(block, "OP");
            return op === "ROUNDUP" ? Math.ceil(n) : op === "ROUNDDOWN" ? Math.floor(n) : Math.round(n);
        }
        case "math_modulo": {
            const a = await numberOf(run, block, "DIVIDEND", "The number");
            const b = await numberOf(run, block, "DIVISOR", "The divisor");
            if (b === 0) throw new BlockError("Can't divide by zero", block.id);
            return a % b;
        }
        case "math_constrain": {
            const n = await numberOf(run, block, "VALUE", "The number");
            const low = await numberOf(run, block, "LOW", "The lowest");
            const high = await numberOf(run, block, "HIGH", "The highest");
            if (low > high) throw new BlockError(`The lowest (${low}) is above the highest (${high})`, block.id);
            return Math.min(Math.max(n, low), high);
        }
        case "math_random_int": {
            const a = Math.ceil(await numberOf(run, block, "FROM", "The lowest"));
            const b = Math.floor(await numberOf(run, block, "TO", "The highest"));
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            return lo + Math.floor(Math.random() * (hi - lo + 1));
        }
        case "math_random_float":
            return Math.random();
        case "math_number_property": {
            const n = await numberOf(run, block, "NUMBER_TO_CHECK", "The number");
            switch (field(block, "PROPERTY")) {
                case "EVEN":
                    return n % 2 === 0;
                case "ODD":
                    return Math.abs(n % 2) === 1;
                case "PRIME":
                    return isPrime(n);
                case "WHOLE":
                    return Number.isInteger(n);
                case "POSITIVE":
                    return n > 0;
                case "NEGATIVE":
                    return n < 0;
                case "DIVISIBLE_BY": {
                    const d = await numberOf(run, block, "DIVISOR", "The divisor");
                    if (d === 0) throw new BlockError("Can't divide by zero", block.id);
                    return n % d === 0;
                }
            }
            throw new BlockError(`Unknown check ${String(field(block, "PROPERTY"))}`, block.id);
        }
        case "math_on_list": {
            const list = await listOf(run, block, "LIST", "The list");
            const op = field(block, "OP");
            if (op === "RANDOM") {
                if (!list.length) throw new BlockError("The list is empty", block.id);
                return list[Math.floor(Math.random() * list.length)];
            }
            const nums = numbersIn(block, list);
            if (op === "SUM") return nums.reduce((a, b) => a + b, 0);
            if (!nums.length) throw new BlockError("The list is empty", block.id);
            switch (op) {
                case "MIN":
                    return Math.min(...nums);
                case "MAX":
                    return Math.max(...nums);
                case "AVERAGE":
                    return nums.reduce((a, b) => a + b, 0) / nums.length;
                case "MEDIAN":
                    return median(nums);
                case "MODE":
                    return modes(nums);
                case "STD_DEV":
                    return standardDeviation(nums);
            }
            throw new BlockError(`Unknown operation ${String(op)}`, block.id);
        }
        case "text":
            return String(field(block, "TEXT") ?? "");
        case "text_changeCase": {
            const t = await textOf(run, block, "TEXT");
            const c = field(block, "CASE");
            if (c === "UPPERCASE") return t.toUpperCase();
            if (c === "LOWERCASE") return t.toLowerCase();
            return t.replace(/\S+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
        }
        case "text_trim": {
            const t = await textOf(run, block, "TEXT");
            const mode = field(block, "MODE");
            return mode === "LEFT" ? t.trimStart() : mode === "RIGHT" ? t.trimEnd() : t.trim();
        }
        case "text_replace": {
            const from = await textOf(run, block, "FROM");
            const to = await textOf(run, block, "TO");
            const t = await textOf(run, block, "TEXT");
            if (!from) throw new BlockError("Say what to replace", block.id);
            return t.split(from).join(to);
        }
        case "text_reverse":
            return [...(await textOf(run, block, "TEXT"))].reverse().join("");
        case "text_count": {
            const sub = await textOf(run, block, "SUB");
            const t = await textOf(run, block, "TEXT");
            return sub ? t.split(sub).length - 1 : 0;
        }
        case "text_indexOf": {
            const t = await textOf(run, block, "VALUE");
            const find = await textOf(run, block, "FIND");
            return (field(block, "END") === "LAST" ? t.lastIndexOf(find) : t.indexOf(find)) + 1;
        }
        case "text_charAt": {
            const chars = [...(await textOf(run, block, "VALUE"))];
            return chars[await positionOf(run, block, String(field(block, "WHERE")), "AT", chars.length, "text")];
        }
        case "text_getSubstring": {
            const chars = [...(await textOf(run, block, "STRING"))];
            const [start, end] = await rangeOf(run, block, chars.length, "text");
            return chars.slice(start, end).join("");
        }
        case BUILTIN.textTest: {
            const t = await textOf(run, block, "TEXT");
            const part = await textOf(run, block, "PART");
            const op = field(block, "OP");
            return op === "STARTS" ? t.startsWith(part) : op === "ENDS" ? t.endsWith(part) : t.includes(part);
        }
        case BUILTIN.regexTest:
            return regex(await textOf(run, block, "PATTERN")).test(await textOf(run, block, "TEXT"));
        case BUILTIN.regexFind: {
            const match = regex(await textOf(run, block, "PATTERN")).exec(await textOf(run, block, "TEXT"));
            return match ? (match[1] ?? match[0]) : "";
        }
        case BUILTIN.toNumber: {
            const t = (await textOf(run, block, "TEXT")).trim();
            const n = t === "" ? NaN : Number(t);
            if (!Number.isFinite(n)) throw new BlockError(`"${t}" isn't a number`, block.id);
            return n;
        }
        case BUILTIN.base64:
            return base64(String(field(block, "MODE")), await textOf(run, block, "TEXT"));
        case BUILTIN.randomId:
            return crypto.randomUUID();
        case BUILTIN.jsonParse: {
            const t = await textOf(run, block, "TEXT");
            try {
                return JSON.parse(t);
            } catch (err) {
                throw new BlockError(`That isn't JSON: ${err instanceof Error ? err.message : String(err)}`, block.id);
            }
        }
        case BUILTIN.jsonText:
            return JSON.stringify((await value(run, block, "VALUE")) ?? null);
        case BUILTIN.getKey: {
            const key = await textOf(run, block, "KEY");
            const obj = await required(run, block, "OBJECT", "The object");
            if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new BlockError(`Only an object has keys, not ${describe(obj)}`, block.id);
            if (!Object.hasOwn(obj, key)) throw new BlockError(`The object has no "${key}"`, block.id);
            return (obj as Record<string, unknown>)[key];
        }
        case BUILTIN.errorMessage: {
            const message = run.errors.at(-1);
            if (message === undefined) throw new BlockError('The error message only exists inside "if it fails"', block.id);
            return message;
        }
        case BUILTIN.now:
            return Date.now();
        case BUILTIN.timeFormat:
            return formatTime(await numberOf(run, block, "TIME", "The time"), String(field(block, "FORMAT")));
        case BUILTIN.timePart:
            return timePart(await numberOf(run, block, "TIME", "The time"), String(field(block, "PART")));
        case BUILTIN.timeAdd: {
            const amount = await numberOf(run, block, "AMOUNT", "The amount");
            const time = await numberOf(run, block, "TIME", "The time");
            return finite(block, time + amount * unitMs(String(field(block, "UNIT"))));
        }
        case BUILTIN.webGet:
            return web("GET", await textOf(run, block, "URL"), undefined, field(block, "AS") as WebAnswer, run.host.signal);
        case BUILTIN.webPost:
            return web("POST", await textOf(run, block, "URL"), await value(run, block, "BODY"), field(block, "AS") as WebAnswer, run.host.signal);
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
        case "lists_create_empty":
            return [];
        case "lists_repeat": {
            const item = await value(run, block, "ITEM");
            const times = await numberOf(run, block, "NUM", "The number of times");
            if (!Number.isInteger(times) || times < 0 || times > MAX_LOOP_ITERATIONS) throw new BlockError(`A list repeats a whole number of times, 0 to ${MAX_LOOP_ITERATIONS}`, block.id);
            return Array.from({ length: times }, () => item);
        }
        case "lists_getIndex":
            if (field(block, "MODE") === "REMOVE") throw new BlockError("\"remove\" is a step, not a value", block.id);
            return listItem(run, block, field(block, "MODE") === "GET_REMOVE");
        case "lists_getSublist": {
            const list = await listOf(run, block, "LIST", "The list");
            const [start, end] = await rangeOf(run, block, list.length, "list");
            return list.slice(start, end);
        }
        case "lists_indexOf": {
            const list = await listOf(run, block, "VALUE", "The list");
            const find = await value(run, block, "FIND");
            const last = field(block, "END") === "LAST";
            for (let k = 0; k < list.length; k++) {
                const i = last ? list.length - 1 - k : k;
                if (equal(list[i], find)) return i + 1;
            }
            return 0;
        }
        case "lists_sort": {
            const list = [...(await listOf(run, block, "LIST", "The list"))];
            const direction = Number(field(block, "DIRECTION")) === -1 ? -1 : 1;
            const type = field(block, "TYPE");
            if (type === "NUMERIC") {
                const nums = numbersIn(block, list);
                return nums.sort((a, b) => (a - b) * direction);
            }
            const key = (v: unknown) => (type === "IGNORE_CASE" ? asText(v).toLowerCase() : asText(v));
            return list.sort((a, b) => key(a).localeCompare(key(b)) * direction);
        }
        case "lists_reverse":
            return [...(await listOf(run, block, "LIST", "The list"))].reverse();
        case "lists_split": {
            const delimiter = await textOf(run, block, "DELIM");
            if (field(block, "MODE") === "JOIN") return (await listOf(run, block, "INPUT", "The list")).map(asText).join(delimiter);
            const t = await textOf(run, block, "INPUT");
            return delimiter ? t.split(delimiter) : [...t];
        }
        case "lists_length":
            return (await listOf(run, block, "VALUE", "The list")).length;
        case "lists_isEmpty":
            return (await listOf(run, block, "VALUE", "The list")).length === 0;
        case BUILTIN.hasValue: {
            const v = await value(run, block, "VALUE");
            return v !== undefined && v !== null;
        }
        case "procedures_callreturn":
            return call(run, block);
        case "variables_get": {
            const id = variableId(block);
            if (!run.variables.has(id)) throw new BlockError(`${run.names.get(id) ?? "This variable"} has no value yet`, block.id);
            return run.variables.get(id);
        }
    }
    if (parseChoiceBlockType(block.type) || parseRegistryBlockType(block.type)?.kind === "choices") {
        // a dropdown keeps its choice as JSON; "none" is nothing, a missing input
        const choice = field(block, "VALUE");
        try {
            return JSON.parse(String(choice));
        } catch (err) {
            throw new BlockError(`The choice can't be read (${err instanceof Error ? err.message : String(err)}): ${String(choice)}`, block.id);
        }
    }
    const property = parsePropertyBlockType(block.type);
    if (property) {
        const fieldName = field(block, "FIELD");
        if (typeof fieldName !== "string") throw new BlockError("Pick a field", block.id);
        return (await run.host.property(property.typeRef, fieldName, await required(run, block, "VALUE", "The value"), property.project)) ?? null;
    }
    const name = parseRegistryBlockType(block.type);
    if (name?.kind === "value") return run.host.read(name.panelId, name.entry, await gatherInputs(run, block));
    if (name?.kind === "result") {
        const from = (block.extraState as { from?: unknown } | undefined)?.from;
        if (typeof from !== "string" || !from) throw new BlockError("This value names no block to read", block.id);
        const what = `"${parseEntry(name.entry).id}"`;
        if (!run.results.has(from)) throw new BlockError(`This value is empty until its ${what} block runs`, block.id);
        const result = run.results.get(from);
        if (name.key === undefined) return result;
        if (result === null || result === undefined) throw new BlockError(`Its ${what} block gave back nothing`, block.id);
        return (await run.host.property(name.typeRef!, name.key, result, parseEntry(name.entry).project)) ?? null;
    }
    if (name?.kind === "event-value") {
        const running = parseRegistryBlockType(run.hat.type);
        if (running?.kind !== "event" || running.panelId !== name.panelId || running.entry !== name.entry) {
            throw new BlockError(`This value only exists inside "${parseEntry(name.entry).id}" blocks`, block.id);
        }
        // an optional value the firing left out is nothing, which "has a value" tells apart
        return run.payload?.[name.key!] ?? null;
    }
    throw new BlockError(`"${block.type}" can't be a value`, block.id);
}
