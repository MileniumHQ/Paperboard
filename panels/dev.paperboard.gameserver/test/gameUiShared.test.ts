// The pieces every game's screens are built from, without the screens: how
// players that share a name are told apart, and how an install reports.
import { describe, expect, test } from "bun:test";
import { byName, withUniqueNames } from "../src/games/rosterNames";
import { createInstallFlow } from "../src/games/installFlow";

describe("players that share a name", () => {
    const pats = [
        { name: "Pat", id: "a" },
        { name: "Pat", id: "b" },
        { name: "Sam", id: "c" },
    ];

    test("are told apart by their id; the rest keep their name", () => {
        expect(withUniqueNames(pats, (p) => p.id).map((p) => p.name)).toEqual(["Pat (a)", "Pat (b)", "Sam"]);
    });

    test("a player the game says keeps their name, as a bot does", () => {
        const bots = [{ name: "Bot", id: "BOT" }, { name: "Bot", id: "BOT" }];
        expect(withUniqueNames(bots, (p) => p.id, () => true).map((p) => p.name)).toEqual(["Bot", "Bot"]);
    });

    test("a player named by their own id is not renamed to it twice", () => {
        const banned = [{ name: "steam_1", id: "steam_1" }, { name: "steam_1", id: "steam_1" }];
        expect(withUniqueNames(banned, (p) => p.id).map((p) => p.name)).toEqual(["steam_1", "steam_1"]);
    });

    test("sort by name", () => {
        expect([...pats].reverse().sort(byName).map((p) => p.name)).toEqual(["Pat", "Pat", "Sam"]);
    });
});

describe("an install flow", () => {
    test("is running while its work is, then installed", async () => {
        const flow = createInstallFlow();
        let release!: () => void;
        const running = flow.run(() => new Promise<void>((resolve) => { release = resolve; }));
        expect(flow.running()).toBe(true);
        expect(flow.installed()).toBe(false);
        release();
        expect(await running).toBe(true);
        expect([flow.running(), flow.installed(), flow.error()]).toEqual([false, true, ""]);
    });

    test("tells the failure with the work's own message, and a retry starts clean", async () => {
        const flow = createInstallFlow();
        expect(await flow.run(async () => { throw new Error("SteamCMD could not reach Steam"); })).toBe(false);
        expect([flow.running(), flow.installed(), flow.error()]).toEqual([false, false, "SteamCMD could not reach Steam"]);
        expect(await flow.run(async () => {})).toBe(true);
        expect(flow.error()).toBe("");
        flow.reset();
        expect(flow.installed()).toBe(true);
    });
});
