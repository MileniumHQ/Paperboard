// A server as service.ts makes one (createServer), without the panel service
// around it: its state lives here, its triggers are recorded, and saved
// settings land on its stored entry. Service code is handed it directly.
import { Server, type ServerHost } from "../../src/service/server";
import type { GameServerState } from "../../src/service/types";
import type { StoredServer } from "../../src/servers";

export class TestServer extends Server {
    readonly triggers: { id: string; output: unknown }[] = [];
    /** every state the server went through, oldest first */
    readonly states: GameServerState[];
    readonly #waiters = new Set<() => void>();

    constructor(stored: StoredServer, initial: Partial<GameServerState>) {
        const host: ServerHost = {
            changed: (server) => {
                (server as TestServer).states.push(server.state);
                (server as TestServer).#check();
            },
            trigger: (server, id, output) => void (server as TestServer).triggers.push({ id, output }),
            updateSettings: async (server, change) => {
                const settings = change(server.stored.settings);
                server.stored = { ...server.stored, settings };
                (server as TestServer).#check();
                return settings;
            },
        };
        super(stored, host);
        this.states = [];
        this.setState(initial);
        this.states.splice(0, this.states.length - 1);
    }

    #check() {
        for (const check of [...this.#waiters]) check();
    }

    /** resolves once the state satisfies `ready` (checked now and on every change); fails after timeoutMs naming `what` */
    waitFor(ready: (state: GameServerState) => boolean, what: string, timeoutMs = 20_000): Promise<GameServerState> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#waiters.delete(check);
                reject(new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${what}; console:\n${this.state.serverEntries.map((e) => `${e.type}: ${e.content}`).join("\n")}`));
            }, timeoutMs);
            const check = () => {
                if (!ready(this.state)) return;
                clearTimeout(timer);
                this.#waiters.delete(check);
                resolve(this.state);
            };
            this.#waiters.add(check);
            check();
        });
    }
}

export function testServer(server: Partial<StoredServer> & { directory: string }, initial: Partial<GameServerState> = {}): TestServer {
    return new TestServer(
        {
            id: server.id ?? "srv-test",
            name: server.name ?? "Test server",
            game: server.game ?? "minecraft",
            directory: server.directory,
            createdAt: server.createdAt ?? 0,
            settings: server.settings ?? {},
        },
        initial,
    );
}
