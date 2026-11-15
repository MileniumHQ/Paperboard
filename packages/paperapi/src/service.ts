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

export interface ServiceContext<TState> {
    state: TState;
    setState: (
        patchOrUpdater:
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => void;
    /** Tells the panel's page something happened (serviceApi.on); other panels can't hear it. */
    emit: (event: string, payload?: unknown) => void;
    /** @deprecated Actions is being removed: fire a block event (blocksApi) instead. Kept only while Agents moves to Blocks. */
    emitTrigger: <T = any>(triggerId: string, output: T) => void;
}

/** A call the panel's page makes to its own service (serviceApi.call): one input, any JSON back. */
export type ServiceCall<TState> = (ctx: ServiceContext<TState>, input?: any) => unknown | Promise<unknown>;

export interface DefinePanelServiceOptions<
    TState extends Record<string, any>,
    TCalls extends Record<string, ServiceCall<TState>>,
> {
    id?: string;
    state?: TState;
    /**
     * What the panel's own page asks its service, by name. Each is an
     * internal block: the page calls it with serviceApi.call or the
     * bridge, no other panel may, and nothing lists it. What a person would
     * automate is a block of its own (blocksApi).
     */
    calls?: TCalls;
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
        Record<string, (ctx: ServiceContext<TState>) => WidgetChoice[] | Promise<WidgetChoice[]>>
    >;
    onInit?: (ctx: ServiceContext<TState>) => void | Promise<void>;
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
    beforeBackup?: (ctx: ServiceContext<TState>, options: { sourceId?: string }) => void | Promise<void>;
    /** Called before replacing data, while the service can still stop its owned processes. */
    beforeRestore?: (ctx: ServiceContext<TState>, options: { sourceId?: string }) => void | Promise<void>;
    /**
     * Hears each backup of the panel's data end, whoever started it (the
     * panel, a routine backup, the shell): with the record when it was
     * made, or why it failed. It is called once the service runs again, so
     * a backup that stopped the service is heard by the service that
     * started after it. A backup that ends while the service is stopped or
     * not ready is not heard. sourceId is as in beforeBackup.
     */
    afterBackup?: (ctx: ServiceContext<TState>, ended: BackupEnded) => void | Promise<void>;
    /** The same as afterBackup, for a restore; backup is the record restored. */
    afterRestore?: (ctx: ServiceContext<TState>, ended: BackupEnded) => void | Promise<void>;
    /**
     * Stops processes the panel runs so Paperboard can update what they run
     * from: the panel itself, or a runtime package such as Java. It is
     * called when someone chooses Stop and update; options.processes lists
     * the process ids that must stop. Stop them your own way (a game server
     * saves its world and stops); any still running when this resolves is
     * sent a terminate signal. Throwing refuses the update. Without it each
     * process is sent a terminate signal.
     */
    beforeUpdate?: (ctx: ServiceContext<TState>, options: { processes: string[] }) => void | Promise<void>;
    /**
     * Hears an update that beforeUpdate stopped processes for end, with
     * those processes: start them again. After a panel update it is the new
     * release's service that hears it. ok is false when the update failed
     * and the previous release is still in place; start them all the same.
     */
    afterUpdate?: (ctx: ServiceContext<TState>, ended: UpdateEnded) => void | Promise<void>;
}

/** How an update that stopped a panel's processes ended (afterUpdate). */
export interface UpdateEnded {
    processes: string[];
    ok: boolean;
    error?: string;
}

type Blocks = ReturnType<typeof blocksApi.panel>;
type AnyOptions = DefinePanelServiceOptions<any, Record<string, ServiceCall<any>>>;

// how long a failed state sync waits before it tries again, doubling each time
const STATE_RETRY_BASE_MS = 500;
const STATE_RETRY_MAX_MS = 30_000;

export function definePanelService<
    TState extends Record<string, any>,
    TCalls extends Record<string, ServiceCall<TState>> = Record<string, ServiceCall<TState>>,
>(options: DefinePanelServiceOptions<TState, TCalls>) {
    const panelId = options.id || getPanelId();
    // identity is threaded as a parameter everywhere; writing it back to
    // process.env gives two services in one process the same name
    let currentState = { ...(options.state || {}) } as TState;
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
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => {
        const patch =
            typeof patchOrUpdater === "function"
                ? patchOrUpdater(currentState)
                : patchOrUpdater;
        currentState = { ...currentState, ...patch };
        syncState(patch);
    };

    const ctx: ServiceContext<TState> = {
        get state() {
            return currentState;
        },
        setState,
        emit: pageEvents(panelId, blocks, !!options.actions),
        emitTrigger: (triggerId, output) => {
            // quiet: TRANSITIONAL (Actions removal): Actions is deprecated, and its triggers have no page to show a failure in
            actionsApi.emitTrigger(triggerId, output, panelId).catch((err) => console.error(`[Service:${panelId}] Failed to emit trigger '${triggerId}':`, err));
        },
    };

    const registrations: Promise<void>[] = [
        internals,
        ...registerWidgetChoices(blocks, options, ctx, () => ready),
        ...registerCalls(panelId, blocks, options, ctx),
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
        ctx,
        getState: () => currentState,
        setState,
    };
}

// ctx.emit: an event is registered the first time it is emitted, then fired
function pageEvents(panelId: string, blocks: Blocks, legacyActions: boolean): (event: string, payload?: unknown) => void {
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
        // a name that can't be an id is the panel's mistake: thrown where it was made
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

function registerCalls(panelId: string, blocks: Blocks, options: AnyOptions, ctx: ServiceContext<any>): Promise<void>[] {
    if (!options.calls) return [];
    const seen = new Map<string, string>();
    const commands = Object.entries(options.calls).map(([name, call]) => {
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
