// The SDK as the chat fixture sees it: everything real except the one thing
// that needs a daemon, the panel's service client. Its state is settled, and
// its service has a conversation and nothing else, so the fixture decides
// what the chat is told and when. Any other call fails, unless the fixture
// answers it (answers). Every call's input and answer is checked against the
// contract, as the real service checks them.
// the SDK first: the contract this stub stands in for is made with it
export * from "../../../../packages/paperapi/dist/paperapi.es.js";
import { callInputProblem, callOutputProblem, type AnyContract, type CallDefinition } from "../../../../packages/paperapi/dist/paperapi.es.js";
import { DEFAULT_STATE, type ChatEntry } from "../../src/contract";

/** The conversation the service has: what the chat reads when it opens. */
export const conversation: ChatEntry[] = [];

const listeners = new Map<string, Set<(payload: any) => void>>();

/** The service telling every open window something happened: one of the contract's events, by name. */
export function emit(event: string, payload?: unknown): void {
    for (const cb of listeners.get(event) ?? []) cb(structuredClone(payload));
}

/** Calls a fixture answers itself, by the contract's name: what the page asked is in `input`. */
export const answers = new Map<string, (input: Record<string, any>) => unknown>();

const defaults: Record<string, () => unknown> = {
    history: () => structuredClone(conversation),
    pages: () => [],
};

/** The panel's settled state, as the mirror holds it: a fixture changes it before it mounts. */
export const state = { ...structuredClone(DEFAULT_STATE), settings: { name: "Fixture", harness: "claude-code" as const, model: null, compaction: "summarize" as const } };

export function serviceClient(contract: AnyContract) {
    const calls: Record<string, (input?: Record<string, unknown>) => Promise<unknown>> = {};
    for (const [name, def] of Object.entries(contract.calls as Record<string, CallDefinition>)) {
        calls[name] = async (given) => {
            // as it travels: JSON, the fields left undefined gone
            const input = def.input ? (JSON.parse(JSON.stringify(given ?? {})) as Record<string, unknown>) : undefined;
            const refused = callInputProblem(contract, name, input);
            if (refused) throw new Error(refused);
            const answer = answers.get(name) ?? defaults[name];
            if (!answer) throw new Error(`the fixture's service has no answer for "${name}"`);
            const output = await answer(input ?? {});
            const wrong = callOutputProblem(name, def, output);
            if (wrong) throw new Error(wrong);
            return output;
        };
    }
    const events: Record<string, (cb: (payload: any) => void) => () => void> = {};
    for (const name of Object.keys(contract.events)) {
        events[name] = (cb) => {
            const set = listeners.get(name) ?? new Set();
            listeners.set(name, set);
            set.add(cb);
            return () => set.delete(cb);
        };
    }
    return {
        panelId: contract.panelId,
        calls,
        events,
        state: {
            current: () => state,
            subscribe: (): (() => void) => () => {},
            refresh: async () => state,
            error: () => null,
            dispose: () => {},
        },
    };
}
