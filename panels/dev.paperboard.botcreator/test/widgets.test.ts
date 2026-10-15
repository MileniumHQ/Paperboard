// Home widget data (bun test): the hourly command record stays fixed-size and
// truthful about what it observed, slash commands from the live session are
// what it counts, and the status widget never reports servers for a bot that
// is not connected.
import { afterEach, describe, it, expect } from "bun:test";
import type { Client } from "discord.js";
import {
    ACTIVITY_BUCKETS,
    ACTIVITY_BUCKET_MS,
    CommandActivityRecorder,
} from "../src/commandActivity";
import { __botTest, buildWidgetStatus, commandActivity } from "../src/service";

const HOUR = ACTIVITY_BUCKET_MS;
const T0 = 1_000 * HOUR; // an hour boundary

describe("command activity recorder", () => {
    it("counts per hour, oldest first, current hour last", () => {
        const rec = new CommandActivityRecorder(T0);
        rec.record(T0 + 1);
        rec.record(T0 + 2);
        rec.record(T0 + HOUR + 5);
        const snap = rec.snapshot(T0 + HOUR + 10);
        expect(snap.counts).toHaveLength(ACTIVITY_BUCKETS);
        expect(snap.counts.slice(-2)).toEqual([2, 1]);
        expect(snap.total).toBe(3);
        expect(snap.currentBucketStart).toBe(T0 + HOUR);
        expect(snap.since).toBe(T0);
    });

    it("drops hours older than the window instead of growing", () => {
        const rec = new CommandActivityRecorder(T0);
        rec.record(T0);
        // the same ring slot, a full window later: the old hour must not leak in
        rec.record(T0 + ACTIVITY_BUCKETS * HOUR);
        const snap = rec.snapshot(T0 + ACTIVITY_BUCKETS * HOUR);
        expect(snap.counts).toHaveLength(ACTIVITY_BUCKETS);
        expect(snap.total).toBe(1);
        expect(snap.counts[ACTIVITY_BUCKETS - 1]).toBe(1);
        // a day of silence later, nothing is left
        expect(rec.snapshot(T0 + 3 * ACTIVITY_BUCKETS * HOUR).total).toBe(0);
    });
});

type Handler = (...args: any[]) => void;

const recordingFactory = (handlers: Map<string, Handler>) =>
    ({
        login: async () => {},
        destroy: async () => {},
        on: (event: string, handler: Handler) => {
            handlers.set(event, handler);
            return undefined;
        },
    }) as unknown as Client;

const ctx = { emitTrigger: () => {} } as any;

// startBot leaves a live session (client, uptime, command-sync result) in
// module state shared by every suite in the process; stop it so no later
// suite observes this one's session, whatever order the files run in
afterEach(async () => {
    await __botTest.stopBot();
});

describe("command activity from the live session", () => {
    it("records each slash command, not button clicks", async () => {
        const handlers = new Map<string, Handler>();
        await __botTest.startBot("good-token", ctx, () => recordingFactory(handlers));
        const before = commandActivity.snapshot().total;
        const slash = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isModalSubmit: () => false,
            isChatInputCommand: () => true,
            commandName: "not-managed-here",
            guildId: null,
        };
        handlers.get("interactionCreate")!(slash);
        handlers.get("interactionCreate")!(slash);
        expect(commandActivity.snapshot().total).toBe(before + 2);

        handlers.get("interactionCreate")!({
            isButton: () => false,
            isAnySelectMenu: () => false,
            isModalSubmit: () => false,
            isChatInputCommand: () => false,
        });
        expect(commandActivity.snapshot().total).toBe(before + 2);
    });
});

describe("bot status widget", () => {
    const fakeClient = {
        user: { username: "PaperBot", displayAvatarURL: () => "https://cdn/a.png" },
        guilds: { cache: new Map([["g1", {}], ["g2", {}]]) },
    } as unknown as Client;

    it("reports identity and servers for the connected session", async () => {
        await __botTest.startBot("good-token", ctx, () => recordingFactory(new Map()));
        expect(buildWidgetStatus(true, fakeClient)).toEqual({
            configured: true,
            connected: true,
            lastError: null,
            name: "PaperBot",
            avatar: "https://cdn/a.png",
            guildCount: 2,
        });
    });

    it("reports no servers once the gateway drops", async () => {
        const handlers = new Map<string, Handler>();
        await __botTest.startBot("good-token", ctx, () => recordingFactory(handlers));
        handlers.get("shardDisconnect")!({ code: 1006 });
        const status = buildWidgetStatus(true, fakeClient);
        expect(status.connected).toBe(false);
        expect(status.configured).toBe(true);
        expect(status.guildCount).toBe(0);
        expect(status.lastError).toContain("1006");
    });

    it("reports no servers and not set up without a client", () => {
        const status = buildWidgetStatus(false, null);
        expect(status.connected).toBe(false);
        expect(status.configured).toBe(false);
        expect(status.guildCount).toBe(0);
    });
});
