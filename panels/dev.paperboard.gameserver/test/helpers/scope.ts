// A server scope as service.ts builds one (createScope), without the panel
// service around it: state lives here, triggers and events are recorded,
// and saved settings land on the stored server. Run service code for it
// with inServer(scope, () => ...).
import type { ServiceContext } from "@mileniumhq/paperapi";
import { gameServiceFor } from "../../src/games/service";
import type { ServerScope } from "../../src/service/scope";
import type { GameServerState } from "../../src/service/types";
import type { StoredServer } from "../../src/servers";

export interface TestScope extends ServerScope {
    triggers: { id: string; output: unknown }[];
    events: { event: string; payload: unknown }[];
    /** every state the server went through, oldest first */
    history: GameServerState[];
    /** resolves once the state satisfies `ready` (checked now and on every change); fails after timeoutMs naming `what` */
    waitFor(ready: (state: GameServerState) => boolean, what: string, timeoutMs?: number): Promise<GameServerState>;
}

export function testScope(server: Partial<StoredServer> & { directory: string }, initial: Partial<GameServerState> = {}): TestScope {
    const stored: StoredServer = {
        id: server.id ?? "srv-test",
        name: server.name ?? "Test server",
        game: server.game ?? "minecraft",
        directory: server.directory,
        createdAt: server.createdAt ?? 0,
        settings: server.settings ?? {},
    };
    const game = gameServiceFor(stored.game);
    let state: GameServerState = { ...game.initialState(), ...initial };
    const triggers: TestScope["triggers"] = [];
    const events: TestScope["events"] = [];
    const history: GameServerState[] = [state];
    const waiters = new Set<() => void>();
    const ctx: ServiceContext<GameServerState> = {
        get state() {
            return state;
        },
        setState(patch) {
            state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
            history.push(state);
            for (const check of [...waiters]) check();
        },
        emit: (event, payload) => events.push({ event, payload }),
        emitTrigger: (id, output) => triggers.push({ id, output }),
    };
    const scope: TestScope = {
        server: stored,
        legacy: false,
        processIds: game.processIds,
        ctx,
        locals: new Map(),
        activeOperations: 0,
        removing: false,
        unsubscribe: [],
        saveSettings: async (settings) => {
            scope.server = { ...scope.server, settings };
            for (const check of [...waiters]) check();
        },
        bindAction: (def) => def,
        triggers,
        events,
        history,
        waitFor(ready, what, timeoutMs = 20_000) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    waiters.delete(check);
                    reject(new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${what}; console:\n${state.serverEntries.map((e) => `${e.type}: ${e.content}`).join("\n")}`));
                }, timeoutMs);
                const check = () => {
                    if (!ready(state)) return;
                    clearTimeout(timer);
                    waiters.delete(check);
                    resolve(state);
                };
                waiters.add(check);
                check();
            });
        },
    };
    return scope;
}
