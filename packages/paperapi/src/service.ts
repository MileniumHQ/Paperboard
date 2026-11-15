import { actionsApi } from "./actions";
import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import type { ActionDefinition, ActionCategoryDefinition, CustomTypeDefinition } from "./schema";
import { defineType } from "./schema";
import { STATE_EVENT, STATE_VALUE, WIDGET_CHOICES_COMMAND, callBlockId, eventBlockId } from "./serviceCalls";
import { parseWidgetChoices, type WidgetChoice } from "./widgetManifest";
import type { BackupEnded } from "./backups";
import { errorMessage } from "./errors";
import { problemsApi } from "./problems";
import {
    callInputProblem,
    callOutputProblem,
    eventPayloadProblem,
    statePatchProblem,
    type CallDefinition,
    type CallInput,
    type CallOutput,
    type CallsOf,
    type EventsOf,
    type Infer,
    type AnyContract,
    type PanelContract,
    type ScopeOf,
    type Shape,
    type StateOf,
} from "./contract";

type EventShapes = Record<string, Shape<any>>;

export interface ServiceContext<TState, TEvents extends EventShapes | undefined = undefined> {
    state: TState;
    setState: (
        patchOrUpdater:
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => void;
    /**
     * Tells the panel's page something happened (its client's `events`); other
     * panels can't hear it. With a contract the event must be one it names,
     * with the payload it says: anything else throws here.
     */
    emit: TEvents extends EventShapes
        ? <E extends keyof TEvents & string>(event: E, payload: Infer<TEvents[E]>) => void
        : (event: string, payload?: unknown) => void;
    /** @deprecated Actions is being removed: fire a block event (blocksApi) instead. Kept only while Agents moves to Blocks. */
    emitTrigger: <T = any>(triggerId: string, output: T) => void;
}

/** @deprecated An untyped call (serviceApi.call): declare it in a contract (defineContract) instead. Kept only while Game Server and Agents move. */
export type ServiceCall<TState> = (ctx: ServiceContext<TState>, input?: any) => unknown | Promise<unknown>;

/** What runs each call of a contract: its checked input and the scope's values in, its output back. */
export type CallHandlers<C extends PanelContract<any>, TState = ContractState<C, Record<string, any>>> = {
    [K in keyof CallsOf<C>]: (
        input: CallInput<CallsOf<C>[K]>,
        ctx: ServiceContext<TState, EventsOf<C>>,
        scope: ScopeOf<C>,
    ) => CallOutput<CallsOf<C>[K]> | Promise<CallOutput<CallsOf<C>[K]>>;
};

/** What a contract's handlers and hooks are given: its state (or `TState`, for a contract that says nothing of it), and its events to emit. */
export type ContractContext<C extends PanelContract<any>, TState = Record<string, any>> = ServiceContext<ContractState<C, TState>, EventsOf<C>>;

/** The state a service keeps: its contract's, or what `state` starts as when the contract says nothing of it. */
type ContractState<C, TState> = C extends PanelContract<any> ? (StateOf<C> extends undefined ? TState : StateOf<C>) : TState;
type ContextOf<TState, C> = ServiceContext<ContractState<C, TState>, C extends PanelContract<any> ? EventsOf<C> : undefined>;

export interface DefinePanelServiceOptions<
    TState extends Record<string, any>,
    TCalls extends Record<string, ServiceCall<TState>>,
    C extends PanelContract<any> | undefined = undefined,
> {
    id?: string;
    /** what the state starts as; a contract that declares the state says it instead */
    state?: C extends PanelContract<any> ? (StateOf<C> extends undefined ? TState : never) : TState;
    /**
     * The calls, events and state the panel's page and its service agree on
     * (defineContract). `calls` then runs each of its calls, and every
     * input is checked against its shape before its handler runs.
     */
    contract?: C;
    /**
     * What the panel's own page asks its service: with a contract, one
     * handler for each of its calls. Each is an internal block: no other
     * panel may call it, and nothing lists it. What a person would
     * automate is a block of its own (blocksApi).
     *
     * Without a contract (deprecated, kept only while Game Server and
     * Agents move): untyped handlers by name, called with serviceApi.call.
     */
    calls?: C extends PanelContract<any> ? NoInfer<CallHandlers<C, ContractState<C, TState>>> : TCalls;
    /**
     * @deprecated TRANSITIONAL: untyped calls beside a contract's, only
     * while Game Server moves onto its contract slice by slice. Removed with
     * serviceApi.call.
     */
    untypedCalls?: Record<string, ServiceCall<ContractState<C, TState>>>;
    /** @deprecated Actions is being removed: use `calls` and blocks. Kept only while Agents moves to Blocks. */
    actions?: ActionDefinition[] | Record<string, (ctx: ServiceContext<TState>, ...args: any[]) => any>;
    /** @deprecated with `actions` */
    types?: CustomTypeDefinition[];
    /** @deprecated with `actions` */
    categories?: ActionCategoryDefinition[];
    /**
     * What each widget option's dropdown offers in Home's gallery, by widget
     * id then option id, as the manifest declares them. Asked each time the
     * gallery shows the widget, so the list is always current.
     */
    widgetChoices?: Record<
        string,
        Record<string, (ctx: ContextOf<TState, C>) => WidgetChoice[] | Promise<WidgetChoice[]>>
    >;
    onInit?: (ctx: ContextOf<TState, C>) => void | Promise<void>;
    /**
     * Gets the service ready for a backup of its panel's data, which starts
     * once this resolves: the service is then stopped, the data copied, and
     * the service started again. Use it to write out what is in memory and
     * to stop a process the service runs from writing (a game server's
     * save-off); undo that when the service starts again. Throwing refuses
     * the backup. Without it the service is simply stopped for the copy.
     * options.sourceId identifies the named source being copied (including
     * a legacy source). It is absent for a whole-panel backup.
     */
    beforeBackup?: (ctx: ContextOf<TState, C>, options: { sourceId?: string }) => void | Promise<void>;
    /** Called before replacing data, while the service can still stop its owned processes. */
    beforeRestore?: (ctx: ContextOf<TState, C>, options: { sourceId?: string }) => void | Promise<void>;
    /**
     * Hears each backup of the panel's data end, whoever started it (the
     * panel, a routine backup, the shell): with the record when it was
     * made, or why it failed. It is called once the service runs again, so
     * a backup that stopped the service is heard by the service that
     * started after it. A backup that ends while the service is stopped or
     * not ready is not heard. sourceId is as in beforeBackup.
     */
    afterBackup?: (ctx: ContextOf<TState, C>, ended: BackupEnded) => void | Promise<void>;
    /** The same as afterBackup, for a restore; backup is the record restored. */
    afterRestore?: (ctx: ContextOf<TState, C>, ended: BackupEnded) => void | Promise<void>;
    /**
     * Stops processes the panel runs so Paperboard can update what they run
     * from: the panel itself, or a runtime package such as Java. It is
     * called when someone chooses Stop and update; options.processes lists
     * the process ids that must stop. Stop them your own way (a game server
     * saves its world and stops); any still running when this resolves is
     * sent a terminate signal. Throwing refuses the update. Without it each
     * process is sent a terminate signal.
     */
    beforeUpdate?: (ctx: ContextOf<TState, C>, options: { processes: string[] }) => void | Promise<void>;
    /**
     * Hears an update that beforeUpdate stopped processes for end, with
     * those processes: start them again. After a panel update it is the new
     * release's service that hears it. ok is false when the update failed
     * and the previous release is still in place; start them all the same.
     */
    afterUpdate?: (ctx: ContextOf<TState, C>, ended: UpdateEnded) => void | Promise<void>;
}

/** How an update that stopped a panel's processes ended (afterUpdate). */
export interface UpdateEnded {
    processes: string[];
    ok: boolean;
    error?: string;
}

type Blocks = ReturnType<typeof blocksApi.panel>;
type AnyOptions = DefinePanelServiceOptions<any, Record<string, ServiceCall<any>>, any>;

// how long a failed state sync waits before it tries again, doubling each time
const STATE_RETRY_BASE_MS = 500;
const STATE_RETRY_MAX_MS = 30_000;

export function definePanelService<
    TState extends Record<string, any>,
    TCalls extends Record<string, ServiceCall<TState>> = Record<string, ServiceCall<TState>>,
    C extends PanelContract<any> | undefined = undefined,
>(options: DefinePanelServiceOptions<TState, TCalls, C>) {
    type State = ContractState<C, TState>;
    const contract = options.contract as AnyContract | undefined;
    const stateShape = contract?.state?.shape;
    if (contract && options.id && options.id !== contract.panelId) {
        throw new Error(`[Service:${options.id}] its contract is ${contract.panelId}'s`);
    }
    const panelId = contract?.panelId || options.id || getPanelId();
    // identity is threaded as a parameter everywhere; writing it back to
    // process.env gives two services in one process the same name
    let currentState = structuredClone(contract?.state?.initial ?? options.state ?? {}) as State;
    // the page and its service talk over internal blocks of the panel
    const blocks = blocksApi.panel(panelId);

    // the page's state travels on two internal blocks: a value it reads
    // whole when it opens, and an event each change after that fires on
    let ready!: Promise<void>;
    const internals = blocks.register({
        values: [{
            id: STATE_VALUE,
            name: "Panel State",
            internal: true,
            type: "any",
            read: async () => { await ready; return currentState; },
        }],
        events: [{ id: STATE_EVENT, name: "Panel State Changed", internal: true, values: { state: { type: "any", name: "State" } } }],
    });
    const syncState = stateSync(panelId, blocks, internals);

    const setState = (
        patchOrUpdater:
            | Partial<State>
            | ((prev: State) => Partial<State>),
    ) => {
        const patch =
            typeof patchOrUpdater === "function"
                ? patchOrUpdater(currentState)
                : patchOrUpdater;
        // a change the contract's state doesn't allow is the panel's mistake: thrown where it was made
        const problem = stateShape && statePatchProblem(stateShape, patch);
        if (problem) throw new Error(`[Service:${panelId}] ${problem}`);
        currentState = { ...currentState, ...patch };
        syncState(patch);
    };

    const ctx: ServiceContext<State, any> = {
        get state() {
            return currentState;
        },
        setState,
        emit: pageEvents(panelId, blocks, !!options.actions, contract),
        emitTrigger: (triggerId, output) => {
            // quiet: TRANSITIONAL (Actions removal): Actions is deprecated, and its triggers have no page to show a failure in
            actionsApi.emitTrigger(triggerId, output, panelId).catch((err) => console.error(`[Service:${panelId}] Failed to emit trigger '${triggerId}':`, err));
        },
    };

    const registrations: Promise<void>[] = [
        internals,
        ...registerWidgetChoices(blocks, options, ctx, () => ready),
        ...(contract ? registerContractCalls(contract, blocks, options, ctx) : registerCalls(panelId, blocks, options.calls as Record<string, ServiceCall<any>> | undefined, ctx)),
        ...(contract && options.untypedCalls ? registerCalls(panelId, blocks, options.untypedCalls, ctx, contract) : []),
        ...registerLegacyActions(panelId, options, ctx),
    ];

    ready = Promise.all(registrations).then(async () => {
        await options.onInit?.(ctx);
        answerTheDaemon(panelId, options, ctx);
    });
    void ready.catch((err) => {
        console.error(`[Service:${panelId}] initialization failed:`, err);
        // a service the daemon spawned ends on it, so the daemon hears at
        // once that it will never be ready (and restarts it on its backoff)
        // instead of waiting out its readiness deadline; the reason above
        // is on stderr, which the daemon logs
        if (typeof process !== "undefined" && typeof process.send === "function") process.exit(1);
    });

    return {
        panelId,
        ready,
        ctx: ctx as ContextOf<TState, C>,
        getState: () => currentState,
        setState,
    };
}

// ctx.emit: an event is registered the first time it is emitted, then fired
function pageEvents(panelId: string, blocks: Blocks, legacyActions: boolean, contract: AnyContract | undefined): (event: string, payload?: unknown) => void {
    const events = new Map<string, Promise<void>>();
    const registerEvent = (id: string, event: string): Promise<void> => {
        let registered = events.get(id);
        if (!registered) {
            registered = blocks.register({
                events: [{ id, name: event, internal: true, values: { payload: { type: "any", name: "Payload", optional: true } } }],
            });
            events.set(id, registered);
        }
        return registered;
    };
    return (event, payload) => {
        // a name that can't be an id, or an event or payload the contract
        // doesn't say, is the panel's mistake: thrown where it was made
        if (contract) {
            const shape = Object.hasOwn(contract.events, event) ? contract.events[event] : undefined;
            if (!shape) throw new Error(`[Service:${panelId}] The contract has no event "${event}"`);
            const problem = eventPayloadProblem(event, shape, payload);
            if (problem) throw new Error(`[Service:${panelId}] ${problem}`);
        }
        const id = eventBlockId(event);
        // emit is fire-and-forget, with no caller to hear it: a page that
        // missed it is the panel's problem
        void registerEvent(id, event)
            .then(() => blocks.fire(id, payload === undefined ? {} : { payload }))
            .catch((err) => problemsApi.report(panelId, { key: `paperapi:emit:${event}`, title: "The panel's page missed an update", message: `${event}: ${errorMessage(err)}` }));
        // TRANSITIONAL (Actions removal): a page still listening with actionsApi.on hears it too
        if (legacyActions) {
            // quiet: TRANSITIONAL (Actions removal): the deprecated Actions page is the only one listening
            actionsApi.emit(event, payload, panelId).catch((err) => console.error(`[Service:${panelId}] Failed to emit event '${event}':`, err));
        }
    };
}

// Sends each state patch to the page. BOUNDED: one sync in flight per
// service; patches made while it travels merge into the next one, so a
// chatty service (a console printing hundreds of lines a second) cannot pile
// up daemon calls. The page only ever hears patches, so one that fails to
// send is kept and sent again, under anything newer, until it arrives.
function stateSync(panelId: string, blocks: Blocks, internals: Promise<void>): (patch: Record<string, unknown>) => void {
    let unsynced: Record<string, unknown> | null = null;
    let syncing = false;
    let failures = 0;
    const send = () => {
        const state = unsynced;
        unsynced = null;
        syncing = state !== null;
        if (!state) return;
        internals
            .then(() => blocks.fire(STATE_EVENT, { state }))
            .then(
                () => {
                    failures = 0;
                    send();
                },
                (err) => {
                    unsynced = unsynced ? { ...state, ...unsynced } : state;
                    const delay = Math.min(STATE_RETRY_MAX_MS, STATE_RETRY_BASE_MS * 2 ** failures++);
                    console.error(`[Service:${panelId}] Failed to sync state, trying again in ${delay} ms:`, err);
                    setTimeout(send, delay);
                },
            );
    };
    return (patch) => {
        unsynced = unsynced ? { ...unsynced, ...patch } : patch;
        if (!syncing) send();
    };
}

// Home's gallery asks it; the daemon lets the shell in, never another panel
function registerWidgetChoices(blocks: Blocks, options: AnyOptions, ctx: ServiceContext<any>, ready: () => Promise<void>): Promise<void>[] {
    const widgetChoices = options.widgetChoices;
    if (!widgetChoices) return [];
    return [blocks.register({
        commands: [{
            id: WIDGET_CHOICES_COMMAND,
            name: "Widget Choices",
            internal: true,
            inputs: { widget: { type: "text", name: "Widget" }, option: { type: "text", name: "Option" } },
            output: "any",
            outputName: "Choices",
            run: async ({ widget, option }: { widget: string; option: string }) => {
                await ready();
                const supply = Object.hasOwn(widgetChoices, widget) && Object.hasOwn(widgetChoices[widget], option)
                    ? widgetChoices[widget][option]
                    : undefined;
                if (!supply) throw new Error(`This panel's service offers no choices for widget "${widget}" option "${option}"`);
                return parseWidgetChoices(await supply(ctx));
            },
        }],
    })];
}

// DEPRECATED: untyped calls without a contract, kept only while Game Server
// and Agents move onto contracts
function registerCalls(panelId: string, blocks: Blocks, calls: Record<string, ServiceCall<any>> | undefined, ctx: ServiceContext<any>, contract?: AnyContract): Promise<void>[] {
    if (!calls) return [];
    const seen = new Map<string, string>(Object.keys(contract?.calls ?? {}).map((name) => [callBlockId(name), name]));
    const commands = Object.entries(calls).map(([name, call]) => {
        const id = callBlockId(name);
        const clash = seen.get(id);
        if (clash !== undefined) throw new Error(`[Service:${panelId}] the calls "${clash}" and "${name}" share the name ${id}`);
        seen.set(id, name);
        return {
            id,
            name,
            internal: true,
            inputs: { input: { type: "any", name: "Input", optional: true } },
            output: "any",
            outputName: "Result",
            // nothing given back reads as null, so the page always hears an answer
            run: async ({ input }: { input?: unknown }) => (await call(ctx, input)) ?? null,
        };
    });
    return [blocks.register({ commands })];
}

// each call of the contract, its input checked before its handler runs and
// its answer before it leaves
function registerContractCalls(contract: AnyContract, blocks: Blocks, options: AnyOptions, ctx: ServiceContext<any, any>): Promise<void>[] {
    const handlers = (options.calls ?? {}) as Record<string, (input: unknown, ctx: ServiceContext<any, any>, scope: Record<string, unknown>) => unknown>;
    const scopeKeys = Object.keys(contract.scope);
    const defs = contract.calls as Record<string, CallDefinition>;
    for (const name of Object.keys(handlers)) {
        if (!Object.hasOwn(defs, name)) throw new Error(`[Service:${contract.panelId}] "${name}" is not a call of its contract`);
    }
    const commands = Object.entries(defs).map(([name, def]) => {
        const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
        if (typeof handler !== "function") throw new Error(`[Service:${contract.panelId}] the call "${name}" has no handler`);
        return {
            id: callBlockId(name),
            name,
            internal: true,
            inputs: { input: { type: "any", name: "Input", optional: true } },
            output: "any",
            outputName: "Result",
            run: async ({ input }: { input?: unknown }) => {
                const refused = callInputProblem(contract, name, input);
                if (refused) throw new Error(refused);
                // the call's own fields to its input, the scope's beside it
                const given = (input ?? {}) as Record<string, unknown>;
                const scope = Object.fromEntries(scopeKeys.map((key) => [key, given[key]]));
                const own = def.input ? Object.fromEntries(Object.entries(given).filter(([key]) => !scopeKeys.includes(key))) : undefined;
                const output = await handler(own, ctx, scope);
                const wrong = callOutputProblem(name, def, output);
                if (wrong) throw new Error(wrong);
                // nothing given back reads as null, so the page always hears an answer
                return output ?? null;
            },
        };
    });
    return [blocks.register({ commands })];
}

// TRANSITIONAL (Actions removal): a service still declaring v1 actions
// registers them as before. Deleted with actionsApi once Agents moved.
function registerLegacyActions(panelId: string, options: AnyOptions, ctx: ServiceContext<any>): Promise<void>[] {
    if (options.types) for (const typeDef of options.types) defineType(typeDef);
    if (Array.isArray(options.actions)) {
        return options.actions.map((def) => {
            const category = typeof def.category === "string" ? options.categories?.find((c) => c.name === def.category) ?? def.category : def.category;
            return actionsApi.register({
                ...def,
                category,
                run: def.run ? (_c: any, inputs: any) => def.run!(ctx, inputs) : undefined,
                listen: def.listen ? (_c: any, emitFn: (output: any) => void) => def.listen!(ctx, emitFn) : undefined,
            }, undefined, panelId);
        });
    }
    if (options.actions) {
        const fns: Record<string, (...args: any[]) => any> = {};
        for (const [name, fn] of Object.entries(options.actions)) fns[name] = (...args: any[]) => fn(ctx, ...args);
        return [actionsApi.registerMultiple(fns, panelId)];
    }
    return [];
}

// A spawned service hears the daemon over its process channel: requests it
// answers (the daemon waits for each answer) and notices it only hears.
// Then it tells the daemon it is ready, and which hooks it has.
function answerTheDaemon(panelId: string, options: AnyOptions, ctx: ServiceContext<any>): void {
    if (typeof process === "undefined" || typeof process.send !== "function") return;
    const answer = (type: string, run: (message: any) => unknown) => {
        process.on("message", (message: any) => {
            if (message?.type !== type || typeof message.requestId !== "string") return;
            const done = `${type}-done`;
            void (async () => run(message))().then(
                () => process.send?.({ type: done, requestId: message.requestId }),
                (err) => process.send?.({ type: done, requestId: message.requestId, error: errorMessage(err) }),
            );
        });
    };
    // the daemon doesn't wait on an after-hook, so its failure is the panel's problem
    const hear = (type: string, after: string, run: (message: any) => unknown) => {
        process.on("message", (message: any) => {
            if (message?.type !== type) return;
            void (async () => run(message))().catch((err) =>
                problemsApi.report(panelId, { key: `paperapi:${type}`, title: `Finishing up after ${after} failed`, message: errorMessage(err) }));
        });
    };

    const { beforeBackup, beforeRestore, afterBackup, afterRestore, beforeUpdate, afterUpdate } = options;
    if (beforeBackup) answer("paperboard:before-backup", (m) => beforeBackup(ctx, { sourceId: m.sourceId }));
    if (beforeRestore) answer("paperboard:before-restore", (m) => beforeRestore(ctx, { sourceId: m.sourceId }));
    if (beforeUpdate) {
        answer("paperboard:before-update", (m) => beforeUpdate(ctx, {
            processes: Array.isArray(m.processes) ? m.processes.filter((p: unknown): p is string => typeof p === "string") : [],
        }));
    }
    if (afterUpdate) hear("paperboard:after-update", "an update", (m) => afterUpdate(ctx, m.ended as UpdateEnded));
    if (afterBackup) hear("paperboard:after-backup", "a backup", (m) => afterBackup(ctx, m.ended as BackupEnded));
    if (afterRestore) hear("paperboard:after-restore", "a restore", (m) => afterRestore(ctx, m.ended as BackupEnded));

    process.send({
        type: "paperboard:service-ready",
        panelId,
        beforeBackup: Boolean(beforeBackup),
        beforeRestore: Boolean(beforeRestore),
        afterBackup: Boolean(afterBackup),
        afterRestore: Boolean(afterRestore),
        beforeUpdate: Boolean(beforeUpdate),
        afterUpdate: Boolean(afterUpdate),
    });
}
