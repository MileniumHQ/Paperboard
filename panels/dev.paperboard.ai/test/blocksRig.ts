// The Blocks registry as the service's handle meets it, kept in memory: what
// the service registers is checked with PaperAPI's own validator, and every
// call, result, firing and change is checked the way the registry checks it.

import {
    inputsProblem,
    qualifyTypeRef,
    validateBlockDefinitions,
    valueProblem,
    type BlockKind,
    type BlockSet,
    type BlocksHandle,
    type TypeLookup,
} from "@mileniumhq/paperapi";
import { PANEL_ID } from "../src/contract";

export class TestBlocks implements BlocksHandle {
    readonly panelId = PANEL_ID;
    set: BlockSet | null = null;
    readonly fired: { event: string; payload: Record<string, unknown> }[] = [];
    readonly changes: string[] = [];

    async register(set: BlockSet): Promise<void> {
        validateBlockDefinitions(set, PANEL_ID);
        this.set = set;
        this.fired.length = 0;
        this.changes.length = 0;
    }

    async unregister(kind: BlockKind, id: string): Promise<void> {
        throw new Error(`the service never unregisters blocks (${kind}.${id})`);
    }

    async fire(event: string, payload: Record<string, unknown>): Promise<void> {
        const def = this.registered().events?.find((e) => e.id === event);
        if (!def) throw new Error(`Event "${event}" is not registered`);
        for (const key of Object.keys(payload)) if (!def.values?.[key]) throw new Error(`${def.name} does not fire a value "${key}"`);
        for (const [key, v] of Object.entries(def.values ?? {})) this.check(v.type, payload[key], `${def.name} value "${key}"`);
        this.fired.push({ event, payload });
    }

    async changed(value: string): Promise<void> {
        const def = this.registered().values?.find((v) => v.id === value);
        if (!def) throw new Error(`Value "${value}" is not registered`);
        if (!def.changes) throw new Error(`${def.name} does not declare changes: true`);
        this.changes.push(value);
    }

    async run<T = unknown>(id: string, inputs: Record<string, unknown> = {}): Promise<T> {
        const def = this.registered().commands?.find((c) => c.id === id);
        if (!def) throw new Error(`no command ${id}`);
        this.checkInputs(def.inputs, inputs, def.name);
        const result = await def.run(inputs, { panelId: PANEL_ID });
        if (def.output === undefined) return null as T;
        this.check(def.output, result, `${def.name} returned`);
        return result as T;
    }

    async read<T = unknown>(id: string, inputs: Record<string, unknown> = {}): Promise<T> {
        const def = this.registered().values?.find((v) => v.id === id);
        if (!def) throw new Error(`no value ${id}`);
        this.checkInputs(def.inputs, inputs, def.name);
        const result = await def.read(inputs, { panelId: PANEL_ID });
        this.check(def.type, result, def.name);
        return result as T;
    }

    async property<T = unknown>(type: string, field: string, value: unknown): Promise<T> {
        const def = this.registered().types?.find((t) => t.id === type);
        const f = def?.fields?.[field];
        if (!def || !f) throw new Error(`no field ${type}.${field}`);
        this.check(type, value, def.name);
        const result = f.resolve ? await f.resolve(value, { panelId: PANEL_ID }) : (value as Record<string, unknown>)[field];
        this.check(f.type, result, `${f.name} of ${def.name}`);
        return result as T;
    }

    private registered(): BlockSet {
        if (!this.set) throw new Error("the service registered no blocks");
        return this.set;
    }

    private lookup: TypeLookup = (qualified) => {
        if (!qualified.startsWith(`${PANEL_ID}:`)) return null;
        const type = this.registered().types?.find((t) => `${PANEL_ID}:${t.id}` === qualified);
        if (!type) return undefined;
        return {
            base: type.base,
            fields: Object.fromEntries(
                Object.entries(type.fields ?? {}).map(([k, f]) => [k, { type: qualifyTypeRef(f.type, PANEL_ID), ...(f.resolve ? { resolved: true as const } : {}) }]),
            ),
        };
    };

    private check(type: string, value: unknown, what: string) {
        const problem = valueProblem(qualifyTypeRef(type, PANEL_ID), value, this.lookup);
        if (problem) throw new Error(`${what}: ${problem}`);
    }

    private checkInputs(defs: Record<string, any> | undefined, inputs: Record<string, unknown>, what: string) {
        const qualified = defs && Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { ...v, type: qualifyTypeRef(v.type, PANEL_ID) }]));
        const problem = inputsProblem(inputs, qualified, this.lookup);
        if (problem) throw new Error(`${what}: ${problem}`);
    }
}
