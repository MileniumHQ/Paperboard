import { describe, expect, test } from "bun:test";
import { LEARN_PANELS } from "../src/site/learn/panels";
import { learnPageText, listOf, sentence, trademarkNotice } from "../src/site/trademarks";

const panel = (slug: string) => LEARN_PANELS.find((item) => item.slug === slug)!;

describe("the marketing footer's trademark notice", () => {
    test("each learn page disclaims the names its own copy mentions, and no others", () => {
        expect(trademarkNotice(learnPageText(panel("game-server")))).toEqual({
            names: ["Minecraft", "Terraria", "Palworld", "Team Fortress 2", "Modrinth"],
            owners: ["Mojang Studios", "Microsoft", "Re-Logic", "Pocketpair", "Valve", "Rinth, Inc."],
        });
        expect(trademarkNotice(learnPageText(panel("bot-creator")))).toEqual({
            names: ["Discord"],
            owners: ["Discord Inc."],
        });
        expect(trademarkNotice(learnPageText(panel("agents")))?.owners).toEqual([
            "Mojang Studios",
            "Microsoft",
            "OpenAI",
            "Anthropic",
            "Anomaly",
        ]);
        expect(trademarkNotice(learnPageText(panel("actions")))?.names).toEqual(["Discord"]);
    });
    test("a page that names no one has no notice", () => {
        expect(trademarkNotice(["Connect your panels", "Build workflows"])).toBeUndefined();
    });
    test("TF2 counts as Team Fortress 2", () => {
        expect(trademarkNotice(["Servers for TF2"])?.owners).toEqual(["Valve"]);
    });
    test("lists read as sentences", () => {
        expect(listOf(["Valve"], "or")).toBe("Valve");
        expect(listOf(["Re-Logic", "Valve"], "or")).toBe("Re-Logic or Valve");
        expect(listOf(["Minecraft", "Terraria", "Discord"], "and")).toBe("Minecraft, Terraria, and Discord");
        expect(sentence(listOf(["Valve", "Discord Inc."], "or"))).toBe("Valve or Discord Inc.");
        expect(sentence("Valve")).toBe("Valve.");
    });
});
