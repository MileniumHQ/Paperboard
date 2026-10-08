// Minecraft 26.3 changed the console text the panel reads. Every line below
// is copied from a real dedicated server log (vanilla 26.3 and 26.2,
// 2026-10-08): 26.3 prefixes command feedback with "System chat: " and
// spells the gamerule readout "Game rule X is currently set to V" (no
// colon), so the Game Rules tab never saw live values on 26.3.
import { describe, expect, test } from "bun:test";
import { gamerulesFor, parseGameruleValue } from "../src/core/gamerules";
import { parseChatMessage } from "../src/lib/logs";
import { GAMERULES } from "../src/generated/gamerules.generated";

describe("gamerule readouts", () => {
    test("26.3 query and write confirmation", () => {
        expect(
            parseGameruleValue("[00:22:35] [Server thread/INFO]: System chat: Game rule keep_inventory is currently set to false"),
        ).toEqual({ name: "keep_inventory", value: "false" });
        expect(
            parseGameruleValue("[00:23:21] [Server thread/INFO]: System chat: Game rule keep_inventory is now set to true"),
        ).toEqual({ name: "keep_inventory", value: "true" });
        expect(
            parseGameruleValue("[00:22:01] [Server thread/INFO]: System chat: Game rule random_tick_speed is currently set to 3"),
        ).toEqual({ name: "random_tick_speed", value: "3" });
    });

    test("26.2 and earlier still parse", () => {
        expect(
            parseGameruleValue("[00:22:45] [Server thread/INFO]: Gamerule keep_inventory is currently set to: false"),
        ).toEqual({ name: "keep_inventory", value: "false" });
        expect(
            parseGameruleValue("[00:23:30] [Server thread/INFO]: Gamerule keep_inventory is now set to: true"),
        ).toEqual({ name: "keep_inventory", value: "true" });
    });

    test("other command feedback is not a readout", () => {
        expect(parseGameruleValue("[00:22:01] [Server thread/INFO]: System chat: Incorrect argument for command")).toBeNull();
        expect(
            parseGameruleValue("[00:22:35] [Server thread/INFO]: System chat: There are 0 of a max of 20 players online: "),
        ).toBeNull();
    });
});

test("system chat lines keep reaching the Chat tab on 26.3", () => {
    expect(parseChatMessage("[00:22:35] [Server thread/INFO]: [Not Secure] [Server] hello there")?.text).toBe(
        "[Server] hello there",
    );
    // join/leave are system messages; 26.3 logs those with the prefix
    expect(parseChatMessage("[00:22:35] [Server thread/INFO]: System chat: Steve joined the game")?.text).toBe(
        "Steve joined the game",
    );
    // command feedback with the prefix is not chat
    expect(
        parseChatMessage("[00:22:35] [Server thread/INFO]: System chat: There are 0 of a max of 20 players online: "),
    ).toBeNull();
});

describe("which rules a server accepts", () => {
    test("experimental rules are never offered", () => {
        // the 26.3 server answers "Incorrect argument for command" for it
        // unless the Minecart Improvements experiment is on
        const names = gamerulesFor("26.3").map((rule) => rule.name);
        expect(names).not.toContain("max_minecart_speed");
        expect(names).toContain("keep_inventory");
    });

    test("26.3 offers exactly the rules its server answered", () => {
        // 58 of the 59 registered rules answered a query on a fresh 26.3
        // world; the 59th is max_minecart_speed
        expect(gamerulesFor("26.3")).toHaveLength(58);
        expect(GAMERULES).toHaveLength(59);
    });
});

test("generated defaults are Java Edition values only", () => {
    // the wiki writes Java and Bedrock defaults in one cell; the scraper
    // merged them into "3 1" and "true everyone"
    const byName = new Map(GAMERULES.map((rule) => [rule.name, rule]));
    expect(byName.get("random_tick_speed")?.defaultValue).toBe("3");
    expect(byName.get("locator_bar")?.defaultValue).toBe("true");
    for (const rule of GAMERULES) {
        if (rule.valueType === "boolean") expect(["true", "false"]).toContain(rule.defaultValue);
        if (rule.valueType === "number") expect(rule.defaultValue).toMatch(/^-?\d+$/);
    }
});
