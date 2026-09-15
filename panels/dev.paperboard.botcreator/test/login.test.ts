// bot connection state machine (bun test): a failed login must null the
// client, record the typed error, and emit it — never report "connected"
import { describe, it, expect } from "bun:test";
import type { Client } from "discord.js";
import {
    __botTest,
    clearRecentMessages,
    getConnectionStatus,
    getRecentMessages,
    validatePresenceStatus,
} from "../src/service";

const failingFactory = () =>
    ({
        login: async () => {
            throw new Error("Invalid token");
        },
        destroy: async () => {},
        on: () => {},
    }) as unknown as Client;

describe("bot login failure state", () => {
    it("nulls the client, records the typed error, and emits it", async () => {
        const emitted: { triggerId: string; output: unknown }[] = [];
        const ctx = {
            emitTrigger: (triggerId: string, output: unknown) => {
                emitted.push({ triggerId, output });
            },
        } as any;
        await expect(
            __botTest.startBot("bad-token", ctx, failingFactory),
        ).rejects.toThrow(/Discord login failed: Invalid token/);
        // client nulled: not connected, error recorded, trigger emitted
        const status = getConnectionStatus();
        expect(status.connected).toBe(false);
        expect(status.error).toBe("Invalid token");
        expect(emitted).toEqual([
            { triggerId: "on-connection-error", output: { error: "Invalid token" } },
        ]);
    });

    it("set-status validates against the four legal values", () => {
        for (const s of ["online", "idle", "dnd", "invisible"]) {
            expect(validatePresenceStatus(s)).toBe(s);
        }
        expect(() => validatePresenceStatus("onilne")).toThrow(/Unknown status/);
        expect(() => validatePresenceStatus(undefined)).toThrow(/Unknown status/);
    });
});

// gateway truth mid-session: capture the handlers attachListeners registers
// so tests can fire them the way the gateway would
type Handler = (...args: any[]) => void;

const recordingFactory = (handlers: Map<string, Handler>, hooks: object = {}) =>
    ({
        login: async () => {},
        destroy: (hooks as { destroy?: () => Promise<void> }).destroy ??
            (async () => {
                if (hooks as { destroyGate?: Promise<void> }) {
                    await (hooks as { destroyGate?: Promise<void> }).destroyGate;
                }
            }),
        on: (event: string, handler: Handler) => {
            handlers.set(event, handler);
            return undefined;
        },
    }) as unknown as Client;

const serviceCtx = (emitted: { triggerId: string; output: unknown }[]) =>
    ({
        emitTrigger: (triggerId: string, output: unknown) => {
            emitted.push({ triggerId, output });
        },
    }) as any;

describe("gateway disconnect truth", () => {
    it("shardDisconnect invalidates connected status and emits the error", async () => {
        const handlers = new Map<string, Handler>();
        const emitted: { triggerId: string; output: unknown }[] = [];
        await __botTest.startBot("good-token", serviceCtx(emitted), () =>
            recordingFactory(handlers),
        );
        expect(getConnectionStatus().connected).toBe(true);

        handlers.get("shardDisconnect")!({ code: 1006, reason: "abnormal closure" });
        const status = getConnectionStatus();
        expect(status.connected).toBe(false);
        expect(status.error).toContain("1006");
        expect(emitted.some((e) => e.triggerId === "on-connection-error")).toBe(true);
    });

    it("shardReady after a drop restores connected status", async () => {
        const handlers = new Map<string, Handler>();
        const emitted: { triggerId: string; output: unknown }[] = [];
        await __botTest.startBot("good-token", serviceCtx(emitted), () =>
            recordingFactory(handlers),
        );
        handlers.get("shardDisconnect")!({ code: 1006 });
        expect(getConnectionStatus().connected).toBe(false);
        handlers.get("shardReady")!();
        expect(getConnectionStatus()).toEqual({ connected: true });
    });

    it("invalidated destroys the session permanently", async () => {
        const handlers = new Map<string, Handler>();
        const emitted: { triggerId: string; output: unknown }[] = [];
        const destroyed: boolean[] = [];
        await __botTest.startBot("good-token", serviceCtx(emitted), () =>
            recordingFactory(handlers, {
                destroy: async () => {
                    destroyed.push(true);
                },
            }),
        );
        handlers.get("invalidated")!();
        expect(getConnectionStatus().connected).toBe(false);
        expect(getConnectionStatus().error).toContain("invalidated");
        expect(destroyed.length).toBe(1);
    });

    it("listeners from a superseded session never touch shared state", async () => {
        const firstHandlers = new Map<string, Handler>();
        const secondHandlers = new Map<string, Handler>();
        const emitted: { triggerId: string; output: unknown }[] = [];
        const ctx = serviceCtx(emitted);
        await __botTest.startBot("good-token", ctx, () => recordingFactory(firstHandlers));
        // second login wins the race while the first session's listeners
        // are still registered on its bot object
        await __botTest.startBot("good-token", ctx, () => recordingFactory(secondHandlers));
        // first session's gateway drop must NOT mark the live bot offline
        firstHandlers.get("shardDisconnect")!({ code: 1006 });
        expect(getConnectionStatus().connected).toBe(true);
        // the live session's drop does
        secondHandlers.get("shardDisconnect")!({ code: 1006 });
        expect(getConnectionStatus().connected).toBe(false);
    });
});

describe("superseded session events", () => {
    it("ignores the old session's messages but keeps the live session's", async () => {
        const firstHandlers = new Map<string, Handler>();
        const secondHandlers = new Map<string, Handler>();
        const emitted: { triggerId: string; output: unknown }[] = [];
        const ctx = serviceCtx(emitted);
        const message = {
            author: { bot: false, username: "alice", id: "u1" },
            content: "hi",
            channelId: "c1",
            guildId: "g1",
            id: "m1",
        };

        await __botTest.startBot("good-token", ctx, () => recordingFactory(firstHandlers));
        await __botTest.startBot("good-token", ctx, () => recordingFactory(secondHandlers));

        // the superseded session's gateway event must not be reported as the
        // live bot's activity
        firstHandlers.get("messageCreate")!(message);
        expect(getRecentMessages()).toEqual([]);
        expect(emitted.filter((e) => e.triggerId === "on-message")).toEqual([]);

        // the live session still records and emits normally
        secondHandlers.get("messageCreate")!(message);
        expect(getRecentMessages()).toHaveLength(1);
        expect(emitted.filter((e) => e.triggerId === "on-message")).toHaveLength(1);
        clearRecentMessages();
    });
});

describe("connect race: pre-login supersede", () => {
    it("an attempt resumed mid-stopBot never touches the winner's state", async () => {
        const emitted: { triggerId: string; output: unknown }[] = [];
        const ctx = serviceCtx(emitted);
        let releaseFirstDestroy: () => void = () => {};
        let firstDestroyCalled = 0;
        const gate = new Promise<void>((resolve) => {
            releaseFirstDestroy = resolve;
        });

        // seed session C0; its destroy hangs on the first call
        await __botTest.startBot("t0", ctx, () =>
            recordingFactory(new Map(), {
                destroy: async () => {
                    firstDestroyCalled++;
                    // hang only the FIRST destroy (attempt A's stopBot);
                    // later ones complete so attempt B can proceed
                    if (firstDestroyCalled === 1) await gate;
                },
            }),
        );
        expect(getConnectionStatus().connected).toBe(true);

        // attempt A: its stopBot awaits C0.destroy — suspended mid-flight
        const attemptA = __botTest.startBot("t2", ctx, () => recordingFactory(new Map()));
        // attempt B: completes while A is suspended
        await __botTest.startBot("t3", ctx, () => recordingFactory(new Map()));
        expect(getConnectionStatus().connected).toBe(true);

        // resume A: it must return early (superseded), leaving state alone
        releaseFirstDestroy();
        await attemptA;
        expect(getConnectionStatus().connected).toBe(true);
        expect(getConnectionStatus().error).toBeUndefined();
        expect(firstDestroyCalled).toBeGreaterThanOrEqual(1);
    });
});
