// Actions API v2 for the Blocks panel. A panel registers its types,
// commands, values and events (see blocksSchema.ts); the Blocks panel lists
// them, runs commands, reads values and properties, and listens for events.
// It is its own registry: Actions (v1, actionsApi) keeps working untouched.
import { getTransport, getPanelId } from "./ipc";
import { debugErr } from "./debug";
import {
    blockEntry,
    blockSchema,
    inputProblem,
    inputsProblem,
    withDefaults,
    qualifyTypeRef,
    validateBlockDefinitions,
    valueProblem,
    type BlockChoice,
    type BlockCommandDefinition,
    type BlockContext,
    type BlockDefinitionBaseInputs,
    type BlockInputSchema,
    type BlockEventDefinition,
    type BlockKind,
    type BlockSchema,
    type BlockCategoryDefinition,
    type BlockTypeDefinition,
    type BlockValueDefinition,
    type TypeLookup,
} from "./blocksSchema";

export * from "./blocksSchema";

/** What one panel (or one of its projects) registers in one call. */
export interface BlockSet {
    /**
     * only on the panel's own handle: the sections its blocks and its
     * projects' blocks name, each with the symbol its heading shows.
     * A block registered before its category is declared shows a plain heading.
     */
    categories?: BlockCategoryDefinition[];
    /** only on the panel's own handle: a type is the panel's, whichever project uses it */
    types?: BlockTypeDefinition[];
    commands?: BlockCommandDefinition[];
    values?: BlockValueDefinition[];
    events?: BlockEventDefinition[];
}

export interface BlockProjectDefinition {
    /** stable id: letters, digits, ".", "_" and "-", at most 64; never shown */
    id: string;
    /** what the Blocks toolbox calls it */
    name: string;
    /** a Material Symbols name */
    icon?: string;
    /**
     * a picture shown in place of the icon: a path in the panel's folder, as
     * a manifest's icon is, or a base64 data:image URL; at most 512 KB
     */
    image?: string;
}

/** A panel's blocks, or one project's. */
export interface BlocksHandle {
    readonly panelId: string;
    readonly project?: string;
    /** registers the set, types first; a broken definition registers nothing */
    register(set: BlockSet): Promise<void>;
    unregister(kind: BlockKind, id: string): Promise<void>;
    /** fires an event with its payload, checked against the values it declares */
    fire(event: string, payload: Record<string, unknown>): Promise<void>;
    /** says a value changed, for the "when it changes" blocks */
    changed(value: string): Promise<void>;
}

export interface BlocksProjectHandle extends BlocksHandle {
    readonly project: string;
    /** renames the project, or changes its icon or picture, keeping its blocks */
    update(project: Omit<BlockProjectDefinition, "id">): Promise<void>;
    /** removes the project and every block in it */
    remove(): Promise<void>;
}

/** One registry entry, as listed. */
export interface BlockInfo {
    panelId: string;
    entry: string;
    project?: string;
    schema: BlockSchema;
}

export interface BlockProjectInfo {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
    /** as defined: a path in the panel's folder, or a data:image URL */
    image?: string;
}

export interface BlockCallOptions {
    /** milliseconds; defaults to 30_000, at most 60_000, null waits it out */
    timeoutMs?: number | null;
}

/** What the handlers need of the registry the blocks live in: the daemon, or memory in a test. */
interface Backend {
    register(panelId: string, entry: string, handler: (request: any) => Promise<unknown>, schema: BlockSchema): Promise<void>;
    unregister(panelId: string, entry: string): Promise<void>;
    emit(panelId: string, entry: string, payload: Record<string, unknown> | null): Promise<void>;
}

/** What one registry's panels registered, so payloads and results are checked against their own types. */
interface Registered {
    /** keyed "panel:type" */
    types: Map<string, BlockTypeDefinition>;
    /** keyed "panel:entry" */
    events: Map<string, BlockEventDefinition>;
    values: Map<string, BlockValueDefinition>;
    /** "panel:project" */
    projects: Set<string>;
    /** each category's symbol, keyed "panel:name" */
    categories: Map<string, string>;
}

const newRegistered = (): Registered => ({ types: new Map(), events: new Map(), values: new Map(), projects: new Set(), categories: new Map() });

// what this process registered through the daemon
const processRegistered = newRegistered();

const daemon: Backend = {
    register: async (panelId, entry, handler, schema) => {
        const transport = getTransport();
        await transport.ensureConnected();
        await transport.registerBlock(panelId, entry, handler, schema);
    },
    unregister: (panelId, entry) => getTransport().unregisterBlock(panelId, entry),
    emit: async (panelId, entry, payload) => {
        const transport = getTransport();
        await transport.ensureConnected();
        await transport.call("blocks:emit", { panelId, entry, payload });
    },
};

function lookupFor(panelId: string, registered: Registered): TypeLookup {
    return (qualified) => {
        if (!qualified.startsWith(`${panelId}:`)) return null;
        const type = registered.types.get(qualified);
        if (!type) return undefined;
        return {
            base: type.base,
            fields: Object.fromEntries(
                Object.entries(type.fields ?? {}).map(([k, f]) => [
                    k,
                    { type: qualifyTypeRef(f.type, panelId), ...(f.resolve ? { resolved: true as const } : {}), ...(f.optional ? { optional: true } : {}) },
                ]),
            ),
        };
    };
}

function resolvePanel(panelId?: string): string {
    const pid = panelId || getPanelId();
    if (!pid) throw new Error("Blocks need a panel context (panel ID not found)");
    return pid;
}

function check(problem: string | null, what: string): void {
    if (problem) throw new Error(`${what}: ${problem}`);
}

const absent = (v: unknown) => v === undefined || v === null;

/** A dropdown's choices as the panel has them now, checked so a broken list fails where it's made. */
async function choicesOf(defs: BlockDefinitionBaseInputs | undefined, key: unknown, ctx: BlockContext, what: string): Promise<BlockChoice[]> {
    const input = typeof key === "string" ? defs?.[key] : undefined;
    if (!input) throw new Error(`${what} has no input "${String(key)}"`);
    if (!input.choices) throw new Error(`${what} input "${input.name}" has no choices`);
    const choices = typeof input.choices === "function" ? await input.choices(ctx) : input.choices;
    if (!Array.isArray(choices)) throw new Error(`${what} input "${input.name}" choices must be a list`);
    for (const choice of choices) {
        if (typeof choice?.label !== "string" || !choice.label.trim() || !["string", "number", "boolean"].includes(typeof choice.value)) {
            throw new Error(`${what} input "${input.name}" offers a choice that isn't a label and a text, number or true/false value`);
        }
    }
    return choices;
}

/**
 * Fills defaults and checks the inputs, asking for any choices worked out
 * on demand so a value that's gone (a deleted world) is refused by name.
 */
async function checkedInputs(raw: unknown, defs: BlockDefinitionBaseInputs | undefined, schemas: Record<string, BlockInputSchema> | undefined, lookup: TypeLookup, ctx: BlockContext, what: string): Promise<Record<string, unknown>> {
    const inputs = withDefaults(raw, schemas);
    check(inputsProblem(inputs, schemas, lookup), what);
    const given = (inputs ?? {}) as Record<string, unknown>;
    for (const [key, def] of Object.entries(defs ?? {})) {
        if (typeof def.choices !== "function" || absent(given[key]) || given[key] === "") continue;
        const choices = await choicesOf(defs, key, ctx, what);
        check(inputProblem({ ...schemas![key]!, choices }, given[key], lookup), what);
    }
    return given;
}

function handleFor(panelId: string, project: string | undefined, registered: Registered, backend: Backend): BlocksHandle {
    const ctx: BlockContext = project ? { panelId, project } : { panelId };
    const lookup = lookupFor(panelId, registered);
    const own = (kind: BlockKind, id: string) => `${panelId}:${blockEntry(kind, id, project)}`;

    const register = async (set: BlockSet): Promise<void> => {
        if (project && set.types?.length) {
            throw new Error(`Types belong to the panel, not project "${project}": register them on blocksApi.panel()`);
        }
        if (project && set.categories?.length) {
            throw new Error(`Categories belong to the panel, not project "${project}": register them on blocksApi.panel()`);
        }
        const available = new Set([...registered.types.keys()].filter((k) => k.startsWith(`${panelId}:`)).map((k) => k.slice(panelId.length + 1)));
        validateBlockDefinitions(set, panelId, available);
        for (const category of set.categories ?? []) registered.categories.set(`${panelId}:${category.name}`, category.icon);
        // the listing carries the category's symbol, so the Blocks panel can head the section with it
        const schemaOf = (kind: "command" | "value" | "event", def: { category?: string }) => {
            const schema = blockSchema(kind, def, panelId);
            const icon = def.category === undefined ? undefined : registered.categories.get(`${panelId}:${def.category}`);
            return icon ? ({ ...schema, categoryIcon: icon } as BlockSchema) : schema;
        };

        for (const type of set.types ?? []) {
            const schema = blockSchema("type", type, panelId);
            registered.types.set(`${panelId}:${type.id}`, type);
            await backend.register(panelId, blockEntry("type", type.id), async (request: { field?: unknown; value?: unknown; project?: unknown }) => {
                const field = typeof request?.field === "string" ? type.fields?.[request.field] : undefined;
                if (!field) throw new Error(`${type.name} has no field "${String(request?.field)}"`);
                check(valueProblem(`${panelId}:${type.id}`, request.value, lookup), `${type.name}`);
                let fieldCtx = ctx;
                if (field.perProject) {
                    if (typeof request.project !== "string") throw new Error(`${field.name} of ${type.name} is read in a project: say which one`);
                    if (!registered.projects.has(`${panelId}:${request.project}`)) throw new Error(`${field.name} of ${type.name}: there is no project "${request.project}"`);
                    fieldCtx = { panelId, project: request.project };
                }
                const result = field.resolve ? await field.resolve(request.value, fieldCtx) : (request.value as Record<string, unknown>)[request.field as string];
                if (field.optional && absent(result)) return null;
                check(valueProblem(qualifyTypeRef(field.type, panelId), result, lookup), `${field.name} of ${type.name}`);
                return result;
            }, schema);
        }
        for (const command of set.commands ?? []) {
            const schema = schemaOf("command", command);
            const inputs = (schema as { inputs?: Record<string, BlockInputSchema> }).inputs;
            await backend.register(panelId, blockEntry("command", command.id, project), async (request: { inputs?: unknown; choices?: unknown }) => {
                if (request?.choices !== undefined) return choicesOf(command.inputs, request.choices, ctx, command.name);
                const given = await checkedInputs(request?.inputs, command.inputs, inputs, lookup, ctx, command.name);
                const result = await command.run(given, ctx);
                if (command.output === undefined) return null;
                check(valueProblem(qualifyTypeRef(command.output, panelId), result, lookup), `${command.name} returned`);
                return result;
            }, schema);
        }
        for (const value of set.values ?? []) {
            const schema = schemaOf("value", value);
            const inputs = (schema as { inputs?: Record<string, BlockInputSchema> }).inputs;
            registered.values.set(own("value", value.id), value);
            await backend.register(panelId, blockEntry("value", value.id, project), async (request: { inputs?: unknown; choices?: unknown }) => {
                if (request?.choices !== undefined) return choicesOf(value.inputs, request.choices, ctx, value.name);
                const given = await checkedInputs(request?.inputs, value.inputs, inputs, lookup, ctx, value.name);
                const result = await value.read(given, ctx);
                check(valueProblem(qualifyTypeRef(value.type, panelId), result, lookup), value.name);
                return result;
            }, schema);
        }
        for (const event of set.events ?? []) {
            registered.events.set(own("event", event.id), event);
            await backend.register(panelId, blockEntry("event", event.id, project), async (request: { choices?: unknown }) => {
                if (request?.choices !== undefined) return choicesOf(event.inputs, request.choices, ctx, event.name);
                throw new Error(`${event.name} is an event: it fires, it is not run`);
            }, schemaOf("event", event));
        }
    };

    return {
        panelId,
        ...(project ? { project } : {}),
        register,
        unregister: async (kind, id) => {
            registered.events.delete(own(kind, id));
            registered.values.delete(own(kind, id));
            if (kind === "type") registered.types.delete(`${panelId}:${id}`);
            await backend.unregister(panelId, blockEntry(kind, id, project));
        },
        fire: async (eventId, payload) => {
            const event = registered.events.get(own("event", eventId));
            if (!event) throw new Error(`Event "${eventId}" is not registered${project ? ` in project "${project}"` : ""}`);
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${event.name} fires with an object of its values`);
            for (const key of Object.keys(payload)) {
                if (!event.values?.[key]) throw new Error(`${event.name} does not fire a value "${key}"`);
            }
            for (const [key, v] of Object.entries(event.values ?? {})) {
                if (v.optional && absent(payload[key])) continue;
                check(valueProblem(qualifyTypeRef(v.type, panelId), payload[key], lookup), `${event.name} value "${key}"`);
            }
            await backend.emit(panelId, blockEntry("event", eventId, project), payload);
        },
        changed: async (valueId) => {
            const value = registered.values.get(own("value", valueId));
            if (!value) throw new Error(`Value "${valueId}" is not registered${project ? ` in project "${project}"` : ""}`);
            if (!value.changes) throw new Error(`${value.name} does not declare changes: true, so nothing listens for its changes`);
            await backend.emit(panelId, blockEntry("value", valueId, project), null);
        },
    };
}

/** A project's handle on a registry, with what defining and removing it does there. */
function projectHandle(
    panelId: string,
    project: BlockProjectDefinition,
    registered: Registered,
    backend: Backend,
    define: (project: BlockProjectDefinition) => Promise<void>,
    remove: () => Promise<void>,
): BlocksProjectHandle {
    registered.projects.add(`${panelId}:${project.id}`);
    return {
        ...handleFor(panelId, project.id, registered, backend),
        project: project.id,
        update: (next) => define({ id: project.id, ...next }),
        remove: async () => {
            for (const map of [registered.events, registered.values]) {
                for (const key of [...map.keys()]) if (key.startsWith(`${panelId}:${project.id}/`)) map.delete(key);
            }
            registered.projects.delete(`${panelId}:${project.id}`);
            await remove();
        },
    };
}

async function callEntry<T>(panelId: string, entry: string, request: unknown, options?: BlockCallOptions): Promise<T> {
    const transport = getTransport();
    await transport.ensureConnected();
    const timeoutMs = options?.timeoutMs === undefined ? 30_000 : options.timeoutMs;
    const res = await transport.call("blocks:call", { panelId, entry, request, timeoutMs }, timeoutMs);
    return res?.result as T;
}

function subscribe(source: string, callback: (payload: any) => void): () => void {
    const transport = getTransport();
    const listener = (payload: any) => callback(payload);
    transport.subscribeEvent(source, listener);
    transport.ensureConnected().catch((err) => debugErr(`ensure connected on subscribe ${source}`, err));
    return () => transport.unsubscribeEvent(source, listener);
}

export const blocksApi = {
    /** The panel's own blocks: types, and blocks that belong to no project. */
    panel: (panelId?: string): BlocksHandle => handleFor(resolvePanel(panelId), undefined, processRegistered, daemon),

    /**
     * Defines a project (one game server, one bot), or renames one this
     * panel defined, and returns its handle. Each project's blocks are its
     * own; its toolbox section shows them.
     */
    defineProject: async (project: BlockProjectDefinition, panelId?: string): Promise<BlocksProjectHandle> => {
        const pid = resolvePanel(panelId);
        const define = (p: BlockProjectDefinition) => getTransport().defineBlocksProject(pid, { id: p.id, name: p.name, ...(p.icon ? { icon: p.icon } : {}), ...(p.image ? { image: p.image } : {}) });
        await define(project);
        return projectHandle(pid, project, processRegistered, daemon, define, () => getTransport().removeBlocksProject(pid, project.id));
    },

    /** Every registered block, or one panel's. */
    list: async (panelId?: string): Promise<BlockInfo[]> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("blocks:list", { panelId });
        return (res?.entries ?? []) as BlockInfo[];
    },

    projects: async (panelId?: string): Promise<BlockProjectInfo[]> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("blocks:projects", { panelId });
        return (res?.projects ?? []) as BlockProjectInfo[];
    },

    /** Runs a command; its inputs and result are checked by the panel that owns it. */
    run: <T = unknown>(panelId: string, command: string, inputs?: Record<string, unknown>, options?: BlockCallOptions & { project?: string }): Promise<T> =>
        callEntry<T>(panelId, blockEntry("command", command, options?.project), { inputs: inputs ?? {} }, options),

    /** Reads a value's current state. */
    read: <T = unknown>(panelId: string, value: string, inputs?: Record<string, unknown>, options?: BlockCallOptions & { project?: string }): Promise<T> =>
        callEntry<T>(panelId, blockEntry("value", value, options?.project), { inputs: inputs ?? {} }, options),

    /**
     * Reads one field of a value of a type, as the type's panel answers it.
     * A per-project field needs the project it's read in.
     */
    property: <T = unknown>(typeRef: string, field: string, value: unknown, options?: BlockCallOptions & { project?: string }): Promise<T> => {
        const colon = typeRef.indexOf(":");
        if (colon === -1) throw new Error(`property needs the type as "panel.id:type", got "${typeRef}"`);
        return callEntry<T>(typeRef.slice(0, colon), blockEntry("type", typeRef.slice(colon + 1)), { field, value, ...(options?.project ? { project: options.project } : {}) }, options);
    },

    /**
     * The choices a dropdown offers now, for an input whose choices the
     * panel works out. `entry` is the block's registry entry, as listed.
     */
    choices: (panelId: string, entry: string, input: string, options?: BlockCallOptions): Promise<BlockChoice[]> =>
        callEntry<BlockChoice[]>(panelId, entry, { choices: input }, options),

    /** Calls back each time a panel's event fires, with its payload. */
    onEvent: (panelId: string, event: string, callback: (payload: Record<string, unknown>) => void, project?: string): (() => void) =>
        subscribe(`blocks:${panelId}:${blockEntry("event", event, project)}`, callback),

    /** Calls back each time a panel says one of its values changed. */
    onChange: (panelId: string, value: string, callback: () => void, project?: string): (() => void) =>
        subscribe(`blocks:${panelId}:${blockEntry("value", value, project)}`, () => callback()),

    /** Calls back whenever blocks or projects come or go. */
    onRegistryChange: (callback: (change: unknown) => void): (() => void) => subscribe("blocks:registry-updated", callback),
};

export const blocks = blocksApi;

// ─── In memory, for a panel's tests ─────────────────────────────────────────

/** What a test hears from the blocks it registered in memory. */
export interface MemoryBlocksListeners {
    /** an event fired, after its payload was checked */
    fired?(event: string, payload: Record<string, unknown>, project?: string): void;
    /** a value said it changed */
    changed?(value: string, project?: string): void;
}

/** A Blocks registry kept in memory: the same checks as the daemon's, with no daemon. */
export interface MemoryBlocks {
    /** the panel's own handle, as blocksApi.panel() gives it */
    readonly panel: BlocksHandle;
    defineProject(project: BlockProjectDefinition): Promise<BlocksProjectHandle>;
    /** every block registered, as blocksApi.list() lists them */
    list(): BlockInfo[];
    run<T = unknown>(command: string, inputs?: Record<string, unknown>, options?: { project?: string }): Promise<T>;
    read<T = unknown>(value: string, inputs?: Record<string, unknown>, options?: { project?: string }): Promise<T>;
    /** `type` is the type's id in this panel */
    property<T = unknown>(type: string, field: string, value: unknown, options?: { project?: string }): Promise<T>;
    choices(entry: string, input: string): Promise<BlockChoice[]>;
}

/** What crosses the wire: JSON, so a value the daemon couldn't carry fails here too. */
const overTheWire = <T>(value: T): T => (value === undefined ? (null as T) : JSON.parse(JSON.stringify(value)));

/**
 * A Blocks registry in memory for a panel's tests. Blocks register and run
 * through the same handlers and checks as blocksApi's, and every request
 * and answer goes through JSON as it would over the wire.
 */
export function memoryBlocks(panelId: string, listeners: MemoryBlocksListeners = {}): MemoryBlocks {
    const registered = newRegistered();
    const entries = new Map<string, { handler: (request: any) => Promise<unknown>; schema: BlockSchema }>();
    const backend: Backend = {
        register: async (_panel, entry, handler, schema) => {
            entries.set(entry, { handler, schema: overTheWire(schema) });
        },
        unregister: async (_panel, entry) => {
            if (!entries.delete(entry)) throw new Error(`"${entry}" is not registered`);
        },
        emit: async (_panel, entry, payload) => {
            const slash = entry.indexOf("/");
            const project = slash === -1 ? undefined : entry.slice(0, slash);
            const [kind, ...id] = entry.slice(slash + 1).split(".");
            if (kind === "event") listeners.fired?.(id.join("."), overTheWire(payload ?? {}), project);
            else listeners.changed?.(id.join("."), project);
        },
    };
    const call = async <T>(entry: string, request: unknown): Promise<T> => {
        const found = entries.get(entry);
        if (!found) throw new Error(`"${entry}" is not registered or unavailable`);
        return overTheWire((await found.handler(overTheWire(request))) as T);
    };
    return {
        panel: handleFor(panelId, undefined, registered, backend),
        defineProject: async (project) => projectHandle(panelId, project, registered, backend, async () => {}, async () => {
            for (const entry of [...entries.keys()]) if (entry.startsWith(`${project.id}/`)) entries.delete(entry);
        }),
        list: () =>
            [...entries].map(([entry, { schema }]) => {
                const slash = entry.indexOf("/");
                return { panelId, entry, ...(slash === -1 ? {} : { project: entry.slice(0, slash) }), schema };
            }),
        run: (command, inputs, options) => call(blockEntry("command", command, options?.project), { inputs: inputs ?? {} }),
        read: (value, inputs, options) => call(blockEntry("value", value, options?.project), { inputs: inputs ?? {} }),
        property: (type, field, value, options) => call(blockEntry("type", type), { field, value, ...(options?.project ? { project: options.project } : {}) }),
        choices: (entry, input) => call(entry, { choices: input }),
    };
}
