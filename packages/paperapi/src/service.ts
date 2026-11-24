import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import { STATE_EVENT, STATE_KEY_VALUE, STATE_VALUE, WIDGET_CHOICES_COMMAND, callBlockId, eventBlockId } from "./serviceCalls";
import { parseWidgetChoices, type WidgetChoice } from "./widgetManifest";
import type { BackupContents, BackupCopied, BackupRecord, RestoreEnded } from "./backups";
import { isRecord } from "./records";
import { readValue, typed } from "./protocol";
import { errorMessage } from "./errors";
import { problemsApi } from "./problems";
import {
    callInputProblem,
    callOutputProblem,
    eventPayloadProblem,
    keyedValueProblem,
    statePatchProblem,
    type CallDefinition,
    type CallInput,
    type CallOutput,
    type CallScope,
    type CallsOf,
    type EventsOf,
    type KeyedOf,
    type KeyedPatch,
    type AnyContract,
    type PanelContract,
    type StateOf,
} from "./contract";
import { shape, type Infer, type Shape } from "./shape";

type EventShapes = Record<string, Shape<any>>;

/** One keyed state field as its service keeps it: each change is checked against its shape and pushed alone. */
export interface KeyedEntries<T> {
    get(key: string): T | undefined;
    /** keeps `value` under `key` and pushes it to every window; a value its shape refuses throws here */
    set(key: string, value: T): void;
    /** removes the key; a window following it hears undefined */
    delete(key: string): void;
    keys(): string[];
}

export interface ServiceContext<TState, TEvents extends EventShapes | undefined = undefined, TKeyed = {}> {
    state: TState;
    setState: (
        patchOrUpdater:
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => void;
    /**
     * Tells the panel's page something happened (its client's `events`); other
     * panels can't hear it. The event must be one the contract names, with the
     * payload it says: anything else throws here.
     */
    emit: TEvents extends EventShapes
        ? <E extends keyof TEvents & string>(event: E, payload: Infer<TEvents[E]>) => void
        : (event: string, payload?: unknown) => void;
    /** the contract's keyed state, by field */
    keyed: { readonly [F in keyof TKeyed]: KeyedEntries<TKeyed[F]> };
}

/** What runs each call of a contract: its checked input and the scope's values in, its output back. */
export type CallHandlers<C extends PanelContract<any>, TState = ContractState<C, Record<string, any>>> = {
    [K in keyof CallsOf<C>]: (
        input: CallInput<CallsOf<C>[K]>,
        ctx: ServiceContext<TState, EventsOf<C>, KeyedOf<C>>,
        scope: CallScope<C, CallsOf<C>[K]>,
    ) => CallOutput<CallsOf<C>[K]> | Promise<CallOutput<CallsOf<C>[K]>>;
};

/** What a contract's handlers and hooks are given: its state (or `TState`, for a contract that says nothing of it), and its events to emit. */
export type ContractContext<C extends PanelContract<any>, TState = Record<string, any>> = ServiceContext<ContractState<C, TState>, EventsOf<C>, KeyedOf<C>>;

/** The state a service keeps: its contract's, or what `state` starts as when the contract says nothing of it. */
type ContractState<C, TState> = C extends PanelContract<any> ? (StateOf<C> extends undefined ? TState : StateOf<C>) : TState;
type ContextOf<TState, C> = ServiceContext<ContractState<C, TState>, C extends PanelContract<any> ? EventsOf<C> : undefined, C extends PanelContract<any> ? KeyedOf<C> : {}>;

export interface DefinePanelServiceOptions<
    TState extends Record<string, any>,
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
     * What the panel's own page asks its service: one handler for each of the
     * contract's calls. Each is an internal block: no other panel may call it,
     * and nothing lists it. What a person would automate is a block of its own
     * (blocksApi).
     */
    calls?: C extends PanelContract<any> ? NoInfer<CallHandlers<C, ContractState<C, TState>>> : never;
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
     * Gets ready for a backup of `target` (null for the panel as a whole)
     * and says what it holds. Stop what would write over the copy (a game
     * server's save-off), then resolve with the files: they are copied as
     * they are, and afterBackup hears when you can carry on. Throwing
     * refuses the backup; undo what you began first. A panel without it
     * cannot be backed up.
     */
    beforeBackup?: (ctx: ContextOf<TState, C>, options: { target: string | null }) => BackupContents | Promise<BackupContents>;
    /**
     * The copy beforeBackup made ready is done, or failed: carry on (a game
     * server's save-on). The backup is uploaded after this resolves; a
     * failure here fails the backup.
     */
    afterBackup?: (ctx: ContextOf<TState, C>, copied: BackupCopied) => void | Promise<void>;
    /**
     * Stops what uses `target`'s files before a restore swaps them for
     * the backup's (a game server stops). Throwing refuses the restore;
     * undo what you began first.
     */
    beforeRestore?: (ctx: ContextOf<TState, C>, options: { target: string | null; backup: BackupRecord }) => void | Promise<void>;
    /**
     * The restore beforeRestore made ready ended: the files are the
     * backup's and `data` is what beforeBackup handed over, or the restore
     * failed and the files are as they were. Pick up from them either way
     * (a game server applies its settings and starts again). Throwing on
     * ok puts the files back as they were and calls this again with the
     * failure. A panel without it cannot restore its backups.
     */
    afterRestore?: (ctx: ContextOf<TState, C>, ended: RestoreEnded) => void | Promise<void>;
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
     * Hears how many of the panel's pages are open, on every computer
     * showing them (a widget is not a page): once when the service is
     * ready, then each time one opens or closes. Use it to let go of what
     * only an open page needs, such as a draft no page shows any more. A
     * failure is the panel's problem.
     */
    onPagesChanged?: (ctx: ContextOf<TState, C>, open: number) => void | Promise<void>;
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

// what the daemon asks a service around a backup or restore
const TARGET: Shape<string | null> = shape.nullable(shape.text());
const BACKUP_COPIED: Shape<BackupCopied> = shape.either(
    shape.object({ target: TARGET, ok: shape.oneOf(true) }),
    shape.object({ target: TARGET, ok: shape.oneOf(false), error: shape.text() }),
);
const RESTORE_START: Shape<{ target: string | null; backup: BackupRecord }> = shape.object({ target: TARGET, backup: typed<BackupRecord>() });
const RESTORE_ENDED: Shape<RestoreEnded> = shape.either(
    shape.object({ target: TARGET, backup: typed<BackupRecord>(), ok: shape.oneOf(true), data: typed<unknown>() }),
    shape.object({ target: TARGET, backup: typed<BackupRecord>(), ok: shape.oneOf(false), error: shape.text() }),
);
const PAGES_OPEN: Shape<number> = shape.read((value) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("a count of pages, a whole number from 0");
    return value as number;
});
const UPDATE_ENDED: Shape<UpdateEnded> = shape.object({ processes: shape.list(shape.text()), ok: shape.boolean(), error: shape.optional(shape.text()) });
type AnyOptions = DefinePanelServiceOptions<any, any>;

// how long a failed state sync waits before it tries again, doubling each time
const STATE_RETRY_BASE_MS = 500;
const STATE_RETRY_MAX_MS = 30_000;

export function definePanelService<
    TState extends Record<string, any> = Record<string, any>,
    C extends PanelContract<any> | undefined = undefined,
>(options: DefinePanelServiceOptions<TState, C>) {
    type State = ContractState<C, TState>;
    const contract = options.contract as AnyContract | undefined;
    const stateShape = contract?.state?.shape;
    if (contract && options.id && options.id !== contract.panelId) {
        throw new Error(`[Service:${options.id}] its contract is ${contract.panelId}'s`);
    }
    const panelId = contract?.panelId || options.id || getPanelId();
    endWithTheDaemon(panelId);
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
        events: [{
            id: STATE_EVENT,
            name: "Panel State Changed",
            internal: true,
            values: { state: { type: "any", name: "State", optional: true }, keyed: { type: "any", name: "Keyed State", optional: true } },
        }],
    });
    const syncState = stateSync(panelId, blocks, internals);
    const keyed = contract && Object.keys(contract.keyed).length > 0 ? keyedState(contract, blocks, () => ready, syncState) : null;

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
        syncState({ state: patch });
    };

    const ctx: ServiceContext<State, any, any> = {
        get state() {
            return currentState;
        },
        setState,
        emit: pageEvents(panelId, blocks, contract),
        keyed: keyed?.entries ?? {},
    };

    const registrations: Promise<void>[] = [
        internals,
        ...(keyed ? [keyed.registered] : []),
        ...registerWidgetChoices(blocks, options, ctx, () => ready),
        ...(contract ? registerContractCalls(contract, blocks, options, ctx) : []),
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
function pageEvents(panelId: string, blocks: Blocks, contract: AnyContract | undefined): (event: string, payload?: unknown) => void {
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
    };
}

/** One push to the page: what changed in the state, and in each keyed field, key by key. */
interface StatePush {
    state?: Record<string, unknown>;
    keyed?: KeyedPatch;
}

function mergePush(older: StatePush, newer: StatePush): StatePush {
    const keyed: KeyedPatch = { ...older.keyed };
    for (const [field, changes] of Object.entries(newer.keyed ?? {})) keyed[field] = { ...keyed[field], ...changes };
    return {
        ...(older.state || newer.state ? { state: { ...older.state, ...newer.state } } : {}),
        ...(older.keyed || newer.keyed ? { keyed } : {}),
    };
}

// The contract's keyed state: each field's keys in the service, each change
// checked and pushed alone, and read by the page one key (or one field) at
// a time from an internal value.
function keyedState(contract: AnyContract, blocks: Blocks, ready: () => Promise<void>, sync: (push: StatePush) => void) {
    const panelId = contract.panelId;
    const fields = new Map(Object.keys(contract.keyed).map((field) => [field, new Map<string, unknown>()]));
    const keys = (field: string) => {
        const found = fields.get(field);
        if (!found) throw new Error(`The state has no keyed field "${field}"`);
        return found;
    };
    const entries = Object.fromEntries([...fields].map(([field, values]): [string, KeyedEntries<unknown>] => [field, {
        get: (key) => values.get(key),
        set: (key, value) => {
            // a value the contract doesn't allow is the panel's mistake: thrown where it was made
            const problem = keyedValueProblem(contract, field, key, value);
            if (problem) throw new Error(`[Service:${panelId}] ${problem}`);
            values.set(key, value);
            sync({ keyed: { [field]: { [key]: value } } });
        },
        delete: (key) => {
            if (!values.delete(key)) return;
            sync({ keyed: { [field]: { [key]: null } } });
        },
        keys: () => [...values.keys()],
    }]));
    const registered = blocks.register({
        values: [{
            id: STATE_KEY_VALUE,
            name: "Panel Keyed State",
            internal: true,
            type: "any",
            inputs: { field: { type: "text", name: "Field" }, key: { type: "text", name: "Key", optional: true } },
            read: async ({ field, key }: { field: string; key?: string }) => {
                await ready();
                const values = keys(field);
                // a key the service doesn't have reads as null: the page's undefined
                return key === undefined ? Object.fromEntries(values) : values.has(key) ? values.get(key) : null;
            },
        }],
    });
    return { entries, registered };
}

// Sends each state patch to the page. BOUNDED: one sync in flight per
// service; patches made while it travels merge into the next one, so a
// chatty service (a console printing hundreds of lines a second) cannot pile
// up daemon calls. The page only ever hears patches, so one that fails to
// send is kept and sent again, under anything newer, until it arrives.
function stateSync(panelId: string, blocks: Blocks, internals: Promise<void>): (push: StatePush) => void {
    let unsynced: StatePush | null = null;
    let syncing = false;
    let failures = 0;
    const send = () => {
        const push = unsynced;
        unsynced = null;
        syncing = push !== null;
        if (!push) return;
        internals
            .then(() => blocks.fire(STATE_EVENT, { ...push }))
            .then(
                () => {
                    failures = 0;
                    send();
                },
                (err) => {
                    unsynced = unsynced ? mergePush(push, unsynced) : push;
                    const delay = Math.min(STATE_RETRY_MAX_MS, STATE_RETRY_BASE_MS * 2 ** failures++);
                    console.error(`[Service:${panelId}] Failed to sync state, trying again in ${delay} ms:`, err);
                    setTimeout(send, delay);
                },
            );
    };
    return (push) => {
        unsynced = unsynced ? mergePush(unsynced, push) : push;
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

// each call of the contract, its input checked before its handler runs and
// its answer before it leaves
function registerContractCalls(contract: AnyContract, blocks: Blocks, options: AnyOptions, ctx: ServiceContext<any, any>): Promise<void>[] {
    const handlers = (options.calls ?? {}) as Record<string, (input: unknown, ctx: ServiceContext<any, any, any>, scope: Record<string, unknown>) => unknown>;
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
                // the call's own fields to its input, the scope's beside it; an unscoped call is given no scope
                const given = (input ?? {}) as Record<string, unknown>;
                const scoped = def.unscoped ? [] : scopeKeys;
                const scope = Object.fromEntries(scoped.map((key) => [key, given[key]]));
                const own = def.input ? Object.fromEntries(Object.entries(given).filter(([key]) => !scoped.includes(key))) : undefined;
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

// A spawned service hears the daemon over its process channel: requests it
// answers (the daemon waits for each answer) and notices it only hears.
// Then it tells the daemon it is ready, and which hooks it has.
let endsWithTheDaemon = false;
// A service the daemon spawned holds its process channel. A daemon that
// crashed or was killed never sends the SIGTERM it stops services with, so
// the channel closing is that stop: without it the service would run on,
// and the restarted daemon would start a second copy beside it. It ends as
// SIGTERM ends it, so the panel's own shutdown (a queued save) still runs.
function endWithTheDaemon(panelId: string): void {
    if (endsWithTheDaemon || typeof process === "undefined" || typeof process.send !== "function") return;
    endsWithTheDaemon = true;
    process.once("disconnect", () => {
        console.error(`[Service:${panelId}] the daemon that started this service is gone, so it stops`);
        process.kill(process.pid, "SIGTERM");
    });
}

function answerTheDaemon(panelId: string, options: AnyOptions, ctx: ServiceContext<any>): void {
    if (typeof process === "undefined" || typeof process.send !== "function") return;
    const answer = (type: string, run: (message: Record<string, unknown>) => unknown) => {
        process.on("message", (message: unknown) => {
            if (!isRecord(message) || message.type !== type) return;
            const { requestId } = message;
            if (typeof requestId !== "string") return;
            const done = `${type}-done`;
            void (async () => run(message))().then(
                (result) => process.send?.({ type: done, requestId, result: result ?? null }),
                (err) => process.send?.({ type: done, requestId, error: errorMessage(err) }),
            );
        });
    };
    // the daemon doesn't wait on an after-hook, so its failure (or an
    // ending it can't read) is the panel's problem
    const hear = (type: string, after: string, run: (message: Record<string, unknown>) => unknown) => {
        process.on("message", (message: unknown) => {
            if (!isRecord(message) || message.type !== type) return;
            void (async () => run(message))().catch((err) =>
                problemsApi.report(panelId, { key: `paperapi:${type}`, title: `Finishing up after ${after} failed`, message: errorMessage(err) }));
        });
    };

    const { beforeBackup, beforeRestore, afterBackup, afterRestore, beforeUpdate, afterUpdate, onPagesChanged } = options;
    if (beforeBackup) answer("paperboard:before-backup", (m) => beforeBackup(ctx, { target: readValue(TARGET, m.target, "target") }));
    if (afterBackup) answer("paperboard:after-backup", (m) => afterBackup(ctx, readValue(BACKUP_COPIED, m.copied, "copied")));
    if (beforeRestore) answer("paperboard:before-restore", (m) => beforeRestore(ctx, readValue(RESTORE_START, m.restore, "restore")));
    if (afterRestore) answer("paperboard:after-restore", (m) => afterRestore(ctx, readValue(RESTORE_ENDED, m.ended, "ended")));
    if (beforeUpdate) {
        answer("paperboard:before-update", (m) => beforeUpdate(ctx, {
            processes: Array.isArray(m.processes) ? m.processes.filter((p: unknown): p is string => typeof p === "string") : [],
        }));
    }
    if (afterUpdate) hear("paperboard:after-update", "an update", (m) => afterUpdate(ctx, readValue(UPDATE_ENDED, m.ended, "ended")));
    if (onPagesChanged) {
        process.on("message", (message: unknown) => {
            if (!isRecord(message) || message.type !== "paperboard:pages") return;
            void (async () => onPagesChanged(ctx, readValue(PAGES_OPEN, message.open, "open")))().catch((err) =>
                problemsApi.report(panelId, { key: "paperapi:pages", title: "The panel's service couldn't follow its pages opening and closing", message: errorMessage(err) }));
        });
    }

    process.send({
        type: "paperboard:service-ready",
        panelId,
        beforeBackup: Boolean(beforeBackup),
        beforeRestore: Boolean(beforeRestore),
        afterBackup: Boolean(afterBackup),
        afterRestore: Boolean(afterRestore),
        beforeUpdate: Boolean(beforeUpdate),
        afterUpdate: Boolean(afterUpdate),
        pagesChanged: Boolean(onPagesChanged),
    });
}
