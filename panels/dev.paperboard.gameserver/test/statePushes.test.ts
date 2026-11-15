// Every push from the service is a fresh copy of a server's whole state. What
// the page shows must only hear about what changed: a push that says nothing
// new notifies no one, and one that does is seen once, all together.
import { createStateSignal, keepUnchanged } from "@mileniumhq/paperui/headless";
import { describe, expect, test } from "bun:test";
import { createEffect, createRoot, on, type Accessor } from "solid-js";
import { serverFields } from "../src/core/state";
import type { GameServerState } from "../src/service/types";

/** the page's view of a server's state, made the way a server's page makes it: one state signal, a memo per field */
function pageState() {
    return createRoot((dispose) => {
        const [state, setState] = createStateSignal<GameServerState | null>(null);
        const fields = serverFields(state) as unknown as Record<string, Accessor<unknown>>;
        return { fields, apply: (next: Record<string, unknown>) => setState(next as unknown as GameServerState), dispose };
    });
}

/** a running server's state as the service pushes it: a new copy each time */
const push = (onlinePlayers = ["steve", "alex"]) =>
    JSON.parse(
        JSON.stringify({
            serverStatus: "online",
            serverEntries: [{ type: "info", content: "Done (1.2s)!" }, { type: "info", content: "Steve joined the game" }],
            chatMessages: [{ id: "c1", text: "<Steve> hi", timestamp: "12:00", sender: "Steve", content: "hi" }],
            localIp: "192.168.1.4",
            serverPort: "25565",
            serverMotd: "A Minecraft Server",
            serverLevel: null,
            maxPlayers: 20,
            onlineSince: 1_700_000_000_000,
            serverSoftware: "paper",
            gameSettings: { difficulty: "normal", nested: { a: [1, 2] } },
            serverVersion: "1.21.1",
            ramAllocation: 4,
            activeIssue: { title: "Port in use", description: "Another program", actions: [{ label: "Retry", actionKey: "killPortAndRetry" }] },
            recoveryBlock: null,
            initFailure: null,
            onlinePlayers,
            seenPlayers: ["steve", "alex", "herobrine"],
            playerStats: { steve: { health: 20, food: 18 } },
            playerPositions: { steve: { x: 1, y: 64, z: -3, dimension: "minecraft:overworld" } },
            playerPlaytime: { steve: 3600 },
            gamerules: { keepInventory: "true" },
            installProgress: null,
            modpackProgress: null,
        }),
    ) as Record<string, unknown>;

describe("state pushes", () => {
    test("a push that says nothing new notifies nothing and keeps every value", () => {
        const { fields, apply, dispose: drop } = pageState();
        apply(push());
        const before = Object.fromEntries(Object.entries(fields).map(([key, get]) => [key, get()]));
        const runs: Record<string, number> = {};
        // effects run once the root is set up, so the counting starts after it
        const dispose = createRoot((dispose) => {
            for (const [key, get] of Object.entries(fields)) {
                runs[key] = 0;
                createEffect(on(get, () => runs[key]++));
            }
            return dispose;
        });
        const settled = { ...runs };
        expect(Object.values(settled).every((n) => n === 1)).toBe(true);
        apply(push());
        apply(push());
        expect(runs).toEqual(settled);
        for (const [key, get] of Object.entries(fields)) expect([key, get() === before[key]]).toEqual([key, true]);
        // and a change is still heard, by its readers alone
        apply(push(["steve"]));
        expect(runs.onlinePlayerNames).toBe(2);
        expect(runs.seenPlayerNames).toBe(1);
        expect(runs.serverStatus).toBe(1);
        dispose();
        drop();
    });

    test("a push is applied as one update", () => {
        const { fields, apply, dispose: drop } = pageState();
        apply(push());
        let runs = 0;
        const dispose = createRoot((dispose) => {
            createEffect(on([fields.onlinePlayerNames, fields.serverStatus, fields.maxPlayers], () => runs++));
            return dispose;
        });
        expect(runs).toBe(1);
        apply({ ...push(["steve"]), serverStatus: "stopping", maxPlayers: 10 });
        expect(runs).toBe(2);
        expect([...(fields.onlinePlayerNames() as Set<string>)]).toEqual(["steve"]);
        dispose();
        drop();
    });

    test("a changed value keeps the parts that did not change", () => {
        const prev = { a: { x: 1 }, b: [{ id: "1", t: "one" }, { id: "2", t: "two" }], m: new Map([["k", { v: 1 }]]) };
        const next = { a: { x: 2 }, b: [{ id: "2", t: "two" }, { id: "1", t: "one" }, { id: "3", t: "three" }], m: new Map([["k", { v: 1 }], ["j", { v: 2 }]]) };
        const kept = keepUnchanged(prev, next);
        expect(kept).not.toBe(prev);
        expect(kept).toEqual(next);
        // matched by id wherever they moved
        expect(kept.b[0]).toBe(prev.b[1]);
        expect(kept.b[1]).toBe(prev.b[0]);
        expect(kept.m.get("k")).toBe(prev.m.get("k")!);
        expect(kept.a).not.toBe(prev.a);
    });
});
