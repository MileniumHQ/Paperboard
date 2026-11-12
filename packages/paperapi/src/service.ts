import { actionsApi } from "./actions";
import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import type { ActionDefinition, ActionCategoryDefinition, CustomTypeDefinition } from "./schema";
import { defineType } from "./schema";
import { STATE_EVENT, STATE_VALUE, WIDGET_CHOICES_COMMAND, callBlockId, eventBlockId } from "./serviceCalls";
import { parseWidgetChoices, type WidgetChoice } from "./widgetManifest";
import type { BackupEnded } from "./backups";

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

    // an event is registered the first time it is emitted, then fired
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
    const emit = (event: string, payload?: unknown) => {
        // a name that can't be an id is the panel's mistake: thrown where it was made
        const id = eventBlockId(event);
        void registerEvent(id, event)
            .then(() => blocks.fire(id, payload === undefined ? {} : { payload }))
            .catch((err) => console.error(`[Service:${panelId}] Failed to emit event '${event}':`, err));
        // TRANSITIONAL (Actions removal): a page still listening with actionsApi.on hears it too
        if (options.actions) {
            actionsApi.emit(event, payload, panelId).catch((err) => console.error(`[Service:${panelId}] Failed to emit event '${event}':`, err));
        }
    };

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

    let unsynced: Partial<TState> | null = null;
    let syncing = false;
    const syncState = () => {
        const state = unsynced;
        unsynced = null;
        syncing = state !== null;
        if (!state) return;
        internals
            .then(() => blocks.fire(STATE_EVENT, { state }))
            .catch((err) => {
                console.error(
                    `[Service:${panelId}] Failed to sync state:`,
                    err,
                );
            })
            .finally(syncState);
    };

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
        // BOUNDED: one state sync in flight per service. Patches made while it
        // travels merge into the next one, so a chatty service (a console
        // printing hundreds of lines a second) cannot pile up daemon calls.
        unsynced = unsynced ? { ...unsynced, ...patch } : patch;
        if (!syncing) syncState();
    };

    const ctx: ServiceContext<TState> = {
        get state() {
            return currentState;
        },
        setState,
        emit,
        emitTrigger: (triggerId, output) => {
            actionsApi.emitTrigger(triggerId, output, panelId).catch((err) => console.error(`[Service:${panelId}] Failed to emit trigger '${triggerId}':`, err));
        },
    };

    const registrations: Promise<void>[] = [internals];

    if (options.widgetChoices) {
        const widgetChoices = options.widgetChoices;
        // Home's gallery asks it; the daemon lets the shell in, never another panel
        registrations.push(blocks.register({
            commands: [{
                id: WIDGET_CHOICES_COMMAND,
                name: "Widget Choices",
                internal: true,
                inputs: { widget: { type: "text", name: "Widget" }, option: { type: "text", name: "Option" } },
                output: "any",
                outputName: "Choices",
                run: async ({ widget, option }: { widget: string; option: string }) => {
                    await ready;
                    const supply = Object.hasOwn(widgetChoices, widget) && Object.hasOwn(widgetChoices[widget], option)
                        ? widgetChoices[widget][option]
                        : undefined;
                    if (!supply) throw new Error(`This panel's service offers no choices for widget "${widget}" option "${option}"`);
                    return parseWidgetChoices(await supply(ctx));
                },
            }],
        }));
    }

    if (options.calls) {
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
        registrations.push(blocks.register({ commands }));
    }

    // TRANSITIONAL (Actions removal): a service still declaring v1 actions
    // registers them as before. Deleted with actionsApi once Agents moved.
    if (options.types) for (const typeDef of options.types) defineType(typeDef);
    if (Array.isArray(options.actions)) {
        for (const def of options.actions) {
            const category = typeof def.category === "string" ? options.categories?.find((c) => c.name === def.category) ?? def.category : def.category;
            registrations.push(actionsApi.register({
                ...def,
                category,
                run: def.run ? (_c: any, inputs: any) => def.run!(ctx, inputs) : undefined,
                listen: def.listen ? (_c: any, emitFn: (output: any) => void) => def.listen!(ctx, emitFn) : undefined,
            }, undefined, panelId));
        }
    } else if (options.actions) {
        const fns: Record<string, (...args: any[]) => any> = {};
        for (const [name, fn] of Object.entries(options.actions)) fns[name] = (...args: any[]) => fn(ctx, ...args);
        registrations.push(actionsApi.registerMultiple(fns, panelId));
    }

    ready = Promise.all(registrations).then(async () => {
        await options.onInit?.(ctx);
        if (typeof process !== "undefined" && typeof process.send === "function") {
            for (const operation of ["backup", "restore"] as const) {
                const hook = operation === "backup" ? options.beforeBackup : options.beforeRestore;
                if (!hook) continue;
                // the daemon asks once per backup and waits for the answer
                process.on("message", (message: any) => {
                    if (message?.type !== `paperboard:before-${operation}` || typeof message.requestId !== "string") return;
                    void (async () => hook(ctx, { sourceId: message.sourceId }))().then(
                        () => process.send?.({ type: `paperboard:before-${operation}-done`, requestId: message.requestId }),
                        (err) => process.send?.({
                            type: `paperboard:before-${operation}-done`,
                            requestId: message.requestId,
                            error: err instanceof Error ? err.message : String(err),
                        }),
                    );
                });
            }
            if (options.beforeUpdate) {
                const hook = options.beforeUpdate;
                process.on("message", (message: any) => {
                    if (message?.type !== "paperboard:before-update" || typeof message.requestId !== "string") return;
                    const processes = Array.isArray(message.processes) ? message.processes.filter((p: unknown): p is string => typeof p === "string") : [];
                    void (async () => hook(ctx, { processes }))().then(
                        () => process.send?.({ type: "paperboard:before-update-done", requestId: message.requestId }),
                        (err) => process.send?.({
                            type: "paperboard:before-update-done",
                            requestId: message.requestId,
                            error: err instanceof Error ? err.message : String(err),
                        }),
                    );
                });
            }
            if (options.afterUpdate) {
                const hook = options.afterUpdate;
                process.on("message", (message: any) => {
                    if (message?.type !== "paperboard:after-update") return;
                    void (async () => hook(ctx, message.ended as UpdateEnded))().catch((err) =>
                        console.error(`[Service:${panelId}] afterUpdate failed:`, err),
                    );
                });
            }
            for (const operation of ["backup", "restore"] as const) {
                const hook = operation === "backup" ? options.afterBackup : options.afterRestore;
                if (!hook) continue;
                process.on("message", (message: any) => {
                    if (message?.type !== `paperboard:after-${operation}`) return;
                    const ended = message.ended as BackupEnded;
                    void (async () => hook(ctx, ended))().catch((err) =>
                        console.error(`[Service:${panelId}] after${operation === "backup" ? "Backup" : "Restore"} failed:`, err),
                    );
                });
            }
            process.send({
                type: "paperboard:service-ready",
                panelId,
                beforeBackup: Boolean(options.beforeBackup),
                beforeRestore: Boolean(options.beforeRestore),
                afterBackup: Boolean(options.afterBackup),
                afterRestore: Boolean(options.afterRestore),
                beforeUpdate: Boolean(options.beforeUpdate),
                afterUpdate: Boolean(options.afterUpdate),
            });
        }
    });
    void ready.catch((err) => console.error(`[Service:${panelId}] initialization failed:`, err));

    return {
        panelId,
        ready,
        ctx,
        getState: () => currentState,
        setState,
    };
}
