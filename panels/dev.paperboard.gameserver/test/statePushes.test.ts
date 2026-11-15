// Every push from the service is a fresh copy of a server's whole state. What
// the page shows must only hear about what changed: a push that says nothing
// new notifies no one, and one that does is seen once, all together.
import { describe, expect, test } from "bun:test";
import { createEffect, createRoot, createSignal } from "solid-js";
import { applyStatePatch, createStateSignal, keepUnchanged, type StateSetters } from "../src/core/state";

/** the page's state signals, made the way lib/server.ts and lib/players.ts make them */
function pageState() {
    const primitive = <T,>(initial: T) => createSignal<T>(initial);
    const signals = {
        serverStatus: primitive<string>("offline"),
        serverEntries: createStateSignal<unknown[]>([]),
        chatMessages: createStateSignal<unknown[]>([]),
        localIp: primitive(""),
        serverPort: primitive(""),
        serverMotd: primitive(""),
        serverLevel: primitive<string | null>(null),
        maxPlayers: primitive<number | null>(null),
        onlineSince: primitive<number | null>(null),
        serverSoftware: primitive(""),
        gameSettings: createStateSignal<Readonly<Record<string, unknown>>>({}),
        serverVersion: primitive(""),
        ramAllocation: primitive(0),
        activeIssue: createStateSignal<unknown>(null),
        recoveryBlock: primitive<string | null>(null),
        initFailure: primitive<string | null>(null),
        onlinePlayers: createStateSignal<Set<string>>(new Set()),
        seenPlayers: createStateSignal<Set<string>>(new Set()),
        playerStats: createStateSignal<Map<string, unknown>>(new Map()),
        playerPositions: createStateSignal<Map<string, unknown>>(new Map()),
        playerPlaytime: createStateSignal<Map<string, number>>(new Map()),
        gamerules: createStateSignal<Record<string, string>>({}),
        installProgress: createStateSignal<unknown>(null),
        modpackProgress: createStateSignal<unknown>(null),
    };
    const setters = {
        setServerStatus: signals.serverStatus[1],
        setServerEntries: signals.serverEntries[1],
        setChatMessages: signals.chatMessages[1],
        setLocalIp: signals.localIp[1],
        setServerPort: signals.serverPort[1],
        setServerMotd: signals.serverMotd[1],
        setServerLevel: signals.serverLevel[1],
        setMaxPlayers: signals.maxPlayers[1],
        setOnlineSince: signals.onlineSince[1],
        setServerSoftware: signals.serverSoftware[1],
        setGameSettings: signals.gameSettings[1],
        setServerVersion: signals.serverVersion[1],
        setRamAllocation: signals.ramAllocation[1],
        setActiveIssue: signals.activeIssue[1],
        setRecoveryBlock: signals.recoveryBlock[1],
        setInitFailure: signals.initFailure[1],
        setOnlinePlayerNames: signals.onlinePlayers[1],
        setSeenPlayerNames: signals.seenPlayers[1],
        setPlayerStats: signals.playerStats[1],
        setPlayerPositions: signals.playerPositions[1],
        setPlayerPlaytime: signals.playerPlaytime[1],
        setGamerules: signals.gamerules[1],
        setInstallProgress: signals.installProgress[1],
        setModpackProgress: signals.modpackProgress[1],
    } as unknown as StateSetters;
    return { signals, setters };
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
        const { signals, setters } = pageState();
        applyStatePatch(push(), setters);
        const before = Object.fromEntries(Object.entries(signals).map(([key, [get]]) => [key, get()]));
        const runs: Record<string, number> = {};
        // effects run once the root is set up, so the counting starts after it
        const dispose = createRoot((dispose) => {
            for (const [key, [get]] of Object.entries(signals)) {
                runs[key] = 0;
                createEffect(() => {
                    get();
                    runs[key]++;
                });
            }
            return dispose;
        });
        const settled = { ...runs };
        expect(Object.values(settled).every((n) => n === 1)).toBe(true);
        applyStatePatch(push(), setters);
        applyStatePatch(push(), setters);
        expect(runs).toEqual(settled);
        for (const [key, [get]] of Object.entries(signals)) expect([key, get() === before[key]]).toEqual([key, true]);
        // and a change is still heard
        applyStatePatch(push(["steve"]), setters);
        expect(runs.onlinePlayers).toBe(2);
        expect(runs.seenPlayers).toBe(1);
        dispose();
    });

    test("a push is applied as one update", () => {
        const { signals, setters } = pageState();
        applyStatePatch(push(), setters);
        let runs = 0;
        const dispose = createRoot((dispose) => {
            createEffect(() => {
                signals.onlinePlayers[0]();
                signals.serverStatus[0]();
                signals.maxPlayers[0]();
                runs++;
            });
            return dispose;
        });
        expect(runs).toBe(1);
        applyStatePatch({ ...push(["steve"]), serverStatus: "stopping", maxPlayers: 10 }, setters);
        expect(runs).toBe(2);
        expect([...signals.onlinePlayers[0]()]).toEqual(["steve"]);
        dispose();
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
