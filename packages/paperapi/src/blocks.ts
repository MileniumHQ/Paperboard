// Actions API v2 for the Blocks panel. A panel registers its types,
// commands, values and events (see blocksSchema.ts); the Blocks panel lists
// them, runs commands, reads values and properties, and listens for events.
// It is its own registry: Actions (v1, actionsApi) keeps working untouched.
import { getTransport, getPanelId } from "./ipc";
import { debugErr } from "./debug";
import {
    blockEntry,
    blockSchema,
    inputsProblem,
    qualifyTypeRef,
    validateBlockDefinitions,
    valueProblem,
    type BlockCommandDefinition,
    type BlockContext,
    type BlockEventDefinition,
    type BlockKind,
    type BlockSchema,
    type BlockTypeDefinition,
    type BlockValueDefinition,
    type TypeLookup,
} from "./blocksSchema";

export * from "./blocksSchema";

/** What one panel (or one of its projects) registers in one call. */
export interface BlockSet {
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
    /** renames the project, or changes its icon, keeping its blocks */
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
}

export interface BlockCallOptions {
    /** milliseconds; defaults to 30_000, at most 60_000, null waits it out */
    timeoutMs?: number | null;
}

// what this process registered, so payloads and results are checked
// against the panel's own types: keyed "panel:type"
const ownTypes = new Map<string, BlockTypeDefinition>();
const ownEvents = new Map<string, BlockEventDefinition>();
const ownValues = new Map<string, BlockValueDefinition>();

function lookupFor(panelId: string): TypeLookup {
    return (qualified) => {
        if (!qualified.startsWith(`${panelId}:`)) return null;
        const type = ownTypes.get(qualified);
        if (!type) return undefined;
        return {
            base: type.base,
            fields: Object.fromEntries(
                Object.entries(type.fields ?? {}).map(([k, f]) => [k, { type: qualifyTypeRef(f.type, panelId), ...(f.resolve ? { resolved: true as const } : {}) }]),
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

function handleFor(panelId: string, project?: string): BlocksHandle {
    const ctx: BlockContext = project ? { panelId, project } : { panelId };
    const lookup = lookupFor(panelId);
    const own = (kind: BlockKind, id: string) => `${panelId}:${blockEntry(kind, id, project)}`;

    const register = async (set: BlockSet): Promise<void> => {
        if (project && set.types?.length) {
            throw new Error(`Types belong to the panel, not project "${project}": register them on blocksApi.panel()`);
        }
        const available = new Set([...ownTypes.keys()].filter((k) => k.startsWith(`${panelId}:`)).map((k) => k.slice(panelId.length + 1)));
        validateBlockDefinitions(set, panelId, available);
        const transport = getTransport();
        await transport.ensureConnected();

        for (const type of set.types ?? []) {
            const schema = blockSchema("type", type, panelId);
            ownTypes.set(`${panelId}:${type.id}`, type);
            await transport.registerBlock(panelId, blockEntry("type", type.id), async (request: { field?: unknown; value?: unknown }) => {
                const field = typeof request?.field === "string" ? type.fields?.[request.field] : undefined;
                if (!field) throw new Error(`${type.name} has no field "${String(request?.field)}"`);
                check(valueProblem(`${panelId}:${type.id}`, request.value, lookup), `${type.name}`);
                const result = field.resolve ? await field.resolve(request.value, ctx) : (request.value as Record<string, unknown>)[request.field as string];
                check(valueProblem(qualifyTypeRef(field.type, panelId), result, lookup), `${field.name} of ${type.name}`);
                return result;
            }, schema);
        }
        for (const command of set.commands ?? []) {
            const schema = blockSchema("command", command, panelId);
            const inputs = (schema as { inputs?: any }).inputs;
            await transport.registerBlock(panelId, blockEntry("command", command.id, project), async (request: { inputs?: unknown }) => {
                check(inputsProblem(request?.inputs, inputs, lookup), command.name);
                const result = await command.run(request?.inputs ?? {}, ctx);
                if (command.output === undefined) return null;
                check(valueProblem(qualifyTypeRef(command.output, panelId), result, lookup), `${command.name} returned`);
                return result;
            }, schema);
        }
        for (const value of set.values ?? []) {
            const schema = blockSchema("value", value, panelId);
            const inputs = (schema as { inputs?: any }).inputs;
            ownValues.set(own("value", value.id), value);
            await transport.registerBlock(panelId, blockEntry("value", value.id, project), async (request: { inputs?: unknown }) => {
                check(inputsProblem(request?.inputs, inputs, lookup), value.name);
                const result = await value.read(request?.inputs ?? {}, ctx);
                check(valueProblem(qualifyTypeRef(value.type, panelId), result, lookup), value.name);
                return result;
            }, schema);
        }
        for (const event of set.events ?? []) {
            ownEvents.set(own("event", event.id), event);
            await transport.registerBlock(panelId, blockEntry("event", event.id, project), () => {
                throw new Error(`${event.name} is an event: it fires, it is not run`);
            }, blockSchema("event", event, panelId));
        }
    };

    return {
        panelId,
        ...(project ? { project } : {}),
        register,
        unregister: async (kind, id) => {
            ownEvents.delete(own(kind, id));
            ownValues.delete(own(kind, id));
            if (kind === "type") ownTypes.delete(`${panelId}:${id}`);
            await getTransport().unregisterBlock(panelId, blockEntry(kind, id, project));
        },
        fire: async (eventId, payload) => {
            const event = ownEvents.get(own("event", eventId));
            if (!event) throw new Error(`Event "${eventId}" is not registered${project ? ` in project "${project}"` : ""}`);
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${event.name} fires with an object of its values`);
            for (const key of Object.keys(payload)) {
                if (!event.values?.[key]) throw new Error(`${event.name} does not fire a value "${key}"`);
            }
            for (const [key, v] of Object.entries(event.values ?? {})) {
                check(valueProblem(qualifyTypeRef(v.type, panelId), payload[key], lookup), `${event.name} value "${key}"`);
            }
            const transport = getTransport();
            await transport.ensureConnected();
            await transport.call("blocks:emit", { panelId, entry: blockEntry("event", eventId, project), payload });
        },
        changed: async (valueId) => {
            const value = ownValues.get(own("value", valueId));
            if (!value) throw new Error(`Value "${valueId}" is not registered${project ? ` in project "${project}"` : ""}`);
            if (!value.changes) throw new Error(`${value.name} does not declare changes: true, so nothing listens for its changes`);
            const transport = getTransport();
            await transport.ensureConnected();
            await transport.call("blocks:emit", { panelId, entry: blockEntry("value", valueId, project), payload: null });
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
    panel: (panelId?: string): BlocksHandle => handleFor(resolvePanel(panelId)),

    /**
     * Defines a project (one game server, one bot), or renames one this
     * panel defined, and returns its handle. Each project's blocks are its
     * own; its toolbox section shows them.
     */
    defineProject: async (project: BlockProjectDefinition, panelId?: string): Promise<BlocksProjectHandle> => {
        const pid = resolvePanel(panelId);
        await getTransport().defineBlocksProject(pid, { id: project.id, name: project.name, ...(project.icon ? { icon: project.icon } : {}) });
        const handle = handleFor(pid, project.id);
        return {
            ...handle,
            project: project.id,
            update: async (next) => {
                await getTransport().defineBlocksProject(pid, { id: project.id, name: next.name, ...(next.icon ? { icon: next.icon } : {}) });
            },
            remove: async () => {
                for (const key of [...ownEvents.keys(), ...ownValues.keys()]) {
                    if (key.startsWith(`${pid}:${project.id}/`)) {
                        ownEvents.delete(key);
                        ownValues.delete(key);
                    }
                }
                await getTransport().removeBlocksProject(pid, project.id);
            },
        };
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

    /** Reads one field of a value of a type, as the type's panel answers it. */
    property: <T = unknown>(typeRef: string, field: string, value: unknown, options?: BlockCallOptions): Promise<T> => {
        const colon = typeRef.indexOf(":");
        if (colon === -1) throw new Error(`property needs the type as "panel.id:type", got "${typeRef}"`);
        return callEntry<T>(typeRef.slice(0, colon), blockEntry("type", typeRef.slice(colon + 1)), { field, value }, options);
    },

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
