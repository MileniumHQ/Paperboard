// A panel's page and its own service agree on one contract: each call's
// input and output shape, and each event's payload, declared once in a file
// both import. The page gets a typed client from it (no names as strings, no
// casts); the service registers handlers for it, and every input is checked
// against its shape before a handler runs, every answer before it leaves.
import { blocksApi } from "./blocks";
import { describeValue } from "./blocksSchema";
import { STATE_EVENT, STATE_KEY_VALUE, callBlockId, eventBlockId } from "./serviceCalls";
import { errorMessage } from "./errors";
import { createPanelBridge } from "./bridge";
import { CALL_TIMEOUT_MAX_MS } from "./protocol/rpc";
import { shape, type Fields, type Infer, type ObjectOf, type ObjectShape, type Shape } from "./shape";

// ─── Contracts ──────────────────────────────────────────────────────────────

/** One call: what the page gives, what the service answers. */
export interface CallDefinition {
    /** an object of fields, left out for a call that takes nothing */
    input?: ObjectShape<any>;
    output: Shape<any>;
    /** milliseconds the page waits for the answer, at most 60_000; defaults to 30_000, null waits it out */
    timeoutMs?: number | null;
    /**
     * A call the contract's scope is not about (making a new server, when
     * the scope is the server): the page calls it without the scope, and
     * its handler is given none. Every other call needs the scope.
     */
    unscoped?: true;
}

export interface ContractDefinition {
    /**
     * Fields every call carries, which the page's client is made with once
     * (the server a Game Server page is about). Each handler is given them
     * beside its input.
     */
    scope?: Fields;
    calls?: Record<string, CallDefinition>;
    /** what the service tells its page, each with its payload's shape */
    events?: Record<string, Shape<any>>;
    /** what the service keeps and every window mirrors, and what it starts as */
    state?: { shape: ObjectShape<any>; initial: unknown };
    /**
     * State kept one key at a time, each key's value of one shape (each
     * server's own state, by its id). A change to a key travels alone, so
     * a busy key never resends the others, and a page reads and follows the
     * keys it shows. Starts with no keys.
     */
    keyed?: Record<string, Shape<any>>;
}

// a contract's initial state is checked against its shape where it is written
type StateChecked<D extends ContractDefinition> = D["state"] extends { shape: infer S } ? { state: { shape: S; initial: Infer<S> } } : unknown;

export interface PanelContract<D extends ContractDefinition = ContractDefinition> {
    readonly panelId: string;
    readonly scope: D["scope"] extends Fields ? D["scope"] : {};
    readonly calls: D["calls"] extends Record<string, CallDefinition> ? D["calls"] : {};
    readonly events: D["events"] extends Record<string, Shape<any>> ? D["events"] : {};
    readonly state: D["state"] extends { shape: ObjectShape<any> } ? { shape: D["state"]["shape"]; initial: Infer<D["state"]["shape"]> } : undefined;
    readonly keyed: D["keyed"] extends Record<string, Shape<any>> ? D["keyed"] : {};
    /** each call's whole input as it travels, its fields and the scope's; null for one that takes nothing */
    readonly inputs: Record<string, ObjectShape | null>;
}

/** A contract as code that serves any contract sees it. */
export interface AnyContract {
    readonly panelId: string;
    readonly scope: Fields;
    readonly calls: Record<string, CallDefinition>;
    readonly events: Record<string, Shape<any>>;
    readonly state: { shape: ObjectShape; initial: unknown } | undefined;
    readonly keyed: Record<string, Shape<any>>;
    readonly inputs: Record<string, ObjectShape | null>;
}

export type CallsOf<C extends PanelContract<any>> = C["calls"];
export type EventsOf<C extends PanelContract<any>> = C["events"];
/** What the service keeps, or undefined for a contract that says nothing of it. */
export type StateOf<C extends PanelContract<any>> = C["state"] extends { shape: infer S } ? Infer<S> : undefined;
/** A call's own fields, as the page gives them and its handler is given them; undefined for one that takes nothing. */
export type CallInput<D extends CallDefinition> = D["input"] extends ObjectShape<any> ? Infer<D["input"]> : undefined;
/** The values every call of the contract carries, which its client is made with. */
export type ScopeOf<C extends PanelContract<any>> = ObjectOf<C["scope"]>;
/** The scope a call is about: the contract's, or none for an unscoped call. */
export type CallScope<C extends PanelContract<any>, D extends CallDefinition> = D extends { unscoped: true } ? {} : ScopeOf<C>;
/** The names of the calls the page makes without the scope. */
export type UnscopedCallsOf<C extends PanelContract<any>> = { [K in keyof CallsOf<C>]: CallsOf<C>[K] extends { unscoped: true } ? K : never }[keyof CallsOf<C>];
/** Each keyed state field's value, by field. */
export type KeyedOf<C extends PanelContract<any>> = { [F in keyof C["keyed"]]: Infer<C["keyed"][F]> };
export type CallOutput<D extends CallDefinition> = Infer<D["output"]>;

/**
 * The contract between a panel's page and its own service, in a file both
 * import: its calls, its events and its state. Names must be letters,
 * digits and dashes once spelled as kebab-case ("renameTab" travels as
 * call-rename-tab), and two may not spell the same.
 */
export function defineContract<const D extends ContractDefinition>(panelId: string, definition: D & StateChecked<D>): PanelContract<D> {
    if (typeof panelId !== "string" || !panelId) throw new Error("A contract needs its panel's id");
    const unique = (names: string[], wire: (name: string) => string, what: string) => {
        const seen = new Map<string, string>();
        for (const name of names) {
            const id = wire(name);
            const clash = seen.get(id);
            if (clash !== undefined) throw new Error(`The ${what}s "${clash}" and "${name}" of ${panelId} share the name ${id}`);
            seen.set(id, name);
        }
    };
    const scope = definition.scope ?? {};
    const calls = definition.calls ?? {};
    unique(Object.keys(calls), callBlockId, "call");
    unique(Object.keys(definition.events ?? {}), eventBlockId, "event");
    const inputs: Record<string, ObjectShape | null> = {};
    const scoped = Object.keys(scope).length > 0;
    for (const [name, def] of Object.entries(calls)) {
        if (def.unscoped && !scoped) throw new Error(`The call "${name}" of ${panelId} is unscoped, but its contract has no scope`);
        // the daemon refuses a longer wait on every call, so the contract can't declare one
        if (typeof def.timeoutMs === "number" && def.timeoutMs > CALL_TIMEOUT_MAX_MS) {
            throw new Error(`The call "${name}" of ${panelId} waits ${def.timeoutMs} ms, over the ${CALL_TIMEOUT_MAX_MS} ms a call can wait; use null for work that runs longer`);
        }
        for (const key of Object.keys(def.input?.fields ?? {})) {
            if (!def.unscoped && Object.hasOwn(scope, key)) throw new Error(`The call "${name}" of ${panelId} names "${key}", which its scope already gives`);
        }
        const fields = def.unscoped ? { ...def.input?.fields } : { ...def.input?.fields, ...scope };
        inputs[name] = Object.keys(fields).length > 0 ? shape.object(fields) : null;
    }
    if (definition.state) {
        const problem = definition.state.shape.check(definition.state.initial, "", true);
        if (problem) throw new Error(`The initial state of ${panelId}'s contract is wrong: ${problem}`);
    }
    const keyed = definition.keyed ?? {};
    for (const [field, value] of Object.entries(keyed)) {
        // a key's null on the wire is the key gone, so a value can't be null
        if (value.check(null, "", false) === null) throw new Error(`The keyed state "${field}" of ${panelId} can't be null: a key without a value is removed`);
    }
    return { panelId, scope, calls, events: definition.events ?? {}, state: definition.state, keyed, inputs } as unknown as PanelContract<D>;
}

function wireInput(contract: AnyContract, name: string): ObjectShape | null {
    if (!Object.hasOwn(contract.inputs, name)) throw new Error(`"${name}" is not a call of ${contract.panelId}'s contract`);
    return contract.inputs[name]!;
}

/** Why `input` can't be given to the call, as the sentence a refusal says, or null. */
export function callInputProblem(contract: AnyContract, name: string, input: unknown): string | null {
    const expected = wireInput(contract, name);
    const problem = expected === null
        ? input === undefined || input === null ? null : `it takes no input, got ${describeValue(input)}`
        : expected.check(input, "", true);
    return problem ? `The call "${name}" was refused: ${problem}` : null;
}

/** Why `output` isn't what the call answers, or null. */
export function callOutputProblem(name: string, def: CallDefinition, output: unknown): string | null {
    const problem = def.output.check(output, "", false);
    return problem ? `The call "${name}" answered what its contract doesn't say: ${problem}` : null;
}

/** Why `payload` isn't what the event carries, or null. */
export function eventPayloadProblem(name: string, payload: Shape<any>, value: unknown): string | null {
    const problem = payload.check(value, "", false);
    return problem ? `The event "${name}" was not sent: ${problem}` : null;
}

/** Why a change to the state isn't what the contract says the state is, or null. */
export function statePatchProblem(state: ObjectShape, patch: Record<string, unknown>): string | null {
    for (const [key, value] of Object.entries(patch)) {
        const def = Object.hasOwn(state.fields, key) ? state.fields[key] : undefined;
        if (!def) return `The state has no field "${key}"`;
        const problem = "optional" in def ? (value === undefined ? null : def.optional.check(value, key, false)) : def.check(value, key, false);
        if (problem) return `The state was not changed: ${problem}`;
    }
    return null;
}

/** Why `value` can't be kept under `key` of the keyed state `field`, or null. */
export function keyedValueProblem(contract: AnyContract, field: string, key: unknown, value: unknown): string | null {
    const def = Object.hasOwn(contract.keyed, field) ? contract.keyed[field] : undefined;
    if (!def) return `The state has no keyed field "${field}"`;
    if (typeof key !== "string" || !key) return `The keyed state "${field}" was not changed: a key is text, got ${describeValue(key)}`;
    const problem = def.check(value, `${field}.${key}`, false);
    return problem ? `The keyed state "${field}" was not changed: ${problem}` : null;
}

// ─── The page's client ──────────────────────────────────────────────────────

/** Hears each value as it comes, until the function it gives back is called. */
export type Subscribe<T> = (onValue: (value: T) => void) => () => void;

/** The calls a page makes with the contract's scope: every call. */
export type ServiceCalls<C extends PanelContract<any>> = {
    [K in keyof CallsOf<C>]: CallsOf<C>[K]["input"] extends ObjectShape<any>
        ? (input: CallInput<CallsOf<C>[K]>) => Promise<CallOutput<CallsOf<C>[K]>>
        : () => Promise<CallOutput<CallsOf<C>[K]>>;
};

/** The service's state as this window mirrors it. */
export interface ServiceState<T> {
    /** what is known now: the contract's initial state until the service's first answer */
    current(): T;
    /** hears the whole state after each change, and what the change was */
    subscribe(onValue: (state: T, patch: Partial<T>) => void): () => void;
    /** reads the whole state again; a change that lands meanwhile wins over it */
    refresh(): Promise<T>;
    /** why the last read failed, or null */
    error(): string | null;
    /**
     * This client lets go of the mirror, and its subscribers hear no more:
     * a client that outlives its window must not keep listening. The mirror
     * stops once every client made for the panel has let go of it.
     */
    dispose(): void;
}

/** The calls a page makes without the contract's scope: the unscoped ones. */
export type UnscopedServiceCalls<C extends PanelContract<any>> = Pick<ServiceCalls<C>, UnscopedCallsOf<C>>;

/**
 * One keyed state field as this window reads it. Late answers lose: a key
 * that changed while a read was out answers with the change.
 */
export interface KeyedState<T> {
    /** reads one key's value; undefined for a key the service doesn't have */
    read(key: string): Promise<T | undefined>;
    /** reads every key's value */
    readAll(): Promise<Record<string, T>>;
    /** hears each change to one key: its new value, or undefined once it is removed */
    follow(key: string): Subscribe<T | undefined>;
}

export interface ServiceClient<C extends PanelContract<any>, Reach extends "scoped" | "unscoped" = "scoped"> {
    readonly panelId: string;
    /** the service's calls, each with its input; the answer is its output. Made without its scope, only the unscoped ones */
    readonly calls: Reach extends "unscoped" ? UnscopedServiceCalls<C> : ServiceCalls<C>;
    /** each event the service emits, to subscribe to */
    readonly events: { [E in keyof EventsOf<C>]: Subscribe<Infer<EventsOf<C>[E]>> };
    /** the service's state, for a contract that declares one: mirrored from the moment the client is made, so the page's readiness waits for it */
    readonly state: StateOf<C> extends undefined ? undefined : ServiceState<StateOf<C>>;
    /** each keyed state field, read and followed one key at a time */
    readonly keyed: { readonly [F in keyof KeyedOf<C>]: KeyedState<KeyedOf<C>[F]> };
}

type ScopeArgs<C extends PanelContract<any>> = keyof C["scope"] extends never ? [] : [scope: ScopeOf<C>];

/**
 * What a panel's page uses to reach its own service, made from the
 * contract and, when it has a scope, the scope's values. Made without the
 * scope, it has only the calls marked unscoped. Another panel is refused.
 */
export function serviceClient<C extends PanelContract<any>>(contract: C, ...scope: ScopeArgs<C>): ServiceClient<C>;
export function serviceClient<C extends PanelContract<any>>(contract: C): ServiceClient<C, "unscoped">;
export function serviceClient<C extends PanelContract<any>>(contract: C, scope?: Record<string, unknown>): ServiceClient<C, any> {
    const calls: Record<string, (input?: Record<string, unknown>) => Promise<unknown>> = {};
    const hasScope = Object.keys(contract.scope).length > 0;
    for (const [name, def] of Object.entries(contract.calls as Record<string, CallDefinition>)) {
        const id = callBlockId(name);
        const options = def.timeoutMs === undefined ? undefined : { timeoutMs: def.timeoutMs };
        const takesInput = wireInput(contract as AnyContract, name) !== null;
        const withScope = hasScope && !def.unscoped;
        if (withScope && scope === undefined) {
            // a client made without the scope has no scoped calls; one reached past the types is refused here
            calls[name] = () => Promise.reject(new Error(`The call "${name}" was refused: it needs the scope (${Object.keys(contract.scope).join(", ")}), and this client was made without it`));
            continue;
        }
        calls[name] = async (input?: Record<string, unknown>) => {
            const given = withScope ? { ...input, ...scope } : input;
            const answer = await blocksApi.run(contract.panelId, id, takesInput ? { input: given } : {}, options);
            // a call that gives nothing back answers null on the wire
            return answer === null && def.output.check(undefined, "", false) === null ? undefined : answer;
        };
    }
    const events: Record<string, Subscribe<unknown>> = {};
    for (const name of Object.keys(contract.events)) {
        const id = eventBlockId(name);
        events[name] = (onValue) => blocksApi.onEvent(contract.panelId, id, (fired) => onValue(fired.payload));
    }
    // the state is mirrored from the moment the client is made, so the page's readiness waits for its first read
    const initial = (contract as AnyContract).state?.initial as Record<string, unknown> | undefined;
    const state = initial ? holdMirror(contract.panelId, initial) : undefined;
    const pushes = keyedPushes(contract.panelId);
    const keyed = Object.fromEntries(Object.keys((contract as AnyContract).keyed).map((field) => [field, keyedState(contract.panelId, field, pushes)]));
    return {
        panelId: contract.panelId,
        calls: calls as ServiceCalls<C>,
        events: events as ServiceClient<C>["events"],
        state: state as ServiceClient<C>["state"],
        keyed: keyed as ServiceClient<C>["keyed"],
    };
}

/** What a push changed in the keyed state: by field, each key's new value, null for one removed. */
export type KeyedPatch = Record<string, Record<string, unknown>>;

// One subscription to the service's pushes for the whole client, held only
// while something reads or follows a key: a client that outlives its window
// keeps nothing open once its followers have stopped.
function keyedPushes(panelId: string): (onPatch: (patch: KeyedPatch) => void) => () => void {
    const listeners = new Set<(patch: KeyedPatch) => void>();
    let off: (() => void) | null = null;
    return (onPatch) => {
        listeners.add(onPatch);
        off ??= blocksApi.onEvent(panelId, STATE_EVENT, (payload) => {
            const patch = payload?.keyed as KeyedPatch | undefined;
            if (!patch) return;
            for (const listener of [...listeners]) listener(patch);
        });
        return () => {
            if (!listeners.delete(onPatch) || listeners.size > 0) return;
            off?.();
            off = null;
        };
    };
}

function keyedState(panelId: string, field: string, pushes: ReturnType<typeof keyedPushes>): KeyedState<unknown> {
    const value = (wire: unknown) => (wire === null ? undefined : wire);
    // a read hears the pushes that land while it is out: a key one changed answers with the change
    const read = async <T>(key: string | undefined, settle: (fetched: T, pushed: Record<string, unknown>) => T): Promise<T> => {
        const pushed: Record<string, unknown> = {};
        const off = pushes((patch) => {
            const changes = Object.hasOwn(patch, field) ? patch[field] : undefined;
            if (changes) Object.assign(pushed, changes);
        });
        try {
            const fetched = await blocksApi.read<T>(panelId, STATE_KEY_VALUE, key === undefined ? { field } : { field, key });
            return settle(fetched, pushed);
        } finally {
            off();
        }
    };
    return {
        read: (key) => read<unknown>(key, (fetched, pushed) => value(Object.hasOwn(pushed, key) ? pushed[key] : fetched)),
        readAll: () =>
            read<Record<string, unknown>>(undefined, (fetched, pushed) => {
                const all = { ...fetched, ...pushed };
                for (const [key, v] of Object.entries(all)) if (v === null) delete all[key];
                return all;
            }),
        follow: (key) => (onValue) =>
            pushes((patch) => {
                const changes = Object.hasOwn(patch, field) ? patch[field] : undefined;
                if (changes && Object.hasOwn(changes, key)) onValue(value(changes[key]));
            }),
    };
}

// One mirror of a panel's state per document, started by the first client
// made for the panel and shared by every client after it: a client made for
// each call (one per server, say) reads nothing more. Each client holds it
// until its state is disposed, and the last to let go stops it.
const mirrors = new Map<string, { state: ServiceState<Record<string, unknown>>; holders: number }>();

function holdMirror(panelId: string, initial: Record<string, unknown>): ServiceState<Record<string, unknown>> {
    let mirror = mirrors.get(panelId);
    if (!mirror) mirrors.set(panelId, (mirror = { state: mirrorState(panelId, initial), holders: 0 }));
    const shared = mirror;
    shared.holders++;
    let held = true;
    // this client's subscribers, which hear no more once it lets go
    const offs = new Set<() => void>();
    return {
        current: () => shared.state.current(),
        subscribe: (onValue) => {
            const off = shared.state.subscribe(onValue);
            offs.add(off);
            return () => {
                offs.delete(off);
                off();
            };
        },
        refresh: () => shared.state.refresh(),
        error: () => shared.state.error(),
        dispose: () => {
            if (!held) return;
            held = false;
            for (const off of offs) off();
            offs.clear();
            if (--shared.holders > 0) return;
            if (mirrors.get(panelId) === shared) mirrors.delete(panelId);
            shared.state.dispose();
        },
    };
}

function mirrorState<T extends Record<string, unknown>>(panelId: string, initial: T): ServiceState<T> {
    const bridge = createPanelBridge<T>({ panelId, defaultState: structuredClone(initial) });
    return {
        current: bridge.getState,
        subscribe: (onValue) => bridge.onStateChange((patch, full) => onValue(full, patch)),
        refresh: bridge.refreshState,
        error: () => bridge.getStatus().error ?? null,
        dispose: bridge.dispose,
    };
}
