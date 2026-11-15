// An embed a flow builds goes out whole or not at all: a field Discord would
// refuse, or embeds that aren't embeds, stop the send and say which.
import { describe, expect, test } from "bun:test";
import { buildDiscordEmbed, buildMessagePayload, normalizeEmbeds } from "../src/payloads";

describe("embeds fail loudly", () => {
    test("a color, link or image Discord would refuse is refused by name", async () => {
        await expect(buildDiscordEmbed({ title: "Hi", color: "not a color" })).rejects.toThrow("Embed color:");
        await expect(buildDiscordEmbed({ title: "Hi", url: "not a link" })).rejects.toThrow("Embed link:");
        await expect(buildDiscordEmbed({ title: "Hi", image: { url: "ftp://example.com/cat.png" } })).rejects.toThrow("Embed image:");
        const embed = await buildDiscordEmbed({ title: "Hi", color: "#ff8800", url: "https://example.com", image: "https://example.com/cat.png", footer: { text: "bye" } });
        expect(embed.toJSON()).toMatchObject({ title: "Hi", color: 0xff8800, url: "https://example.com", image: { url: "https://example.com/cat.png" }, footer: { text: "bye" } });
    });

    test("embeds that aren't embeds refuse the message instead of sending it without them", async () => {
        expect(() => normalizeEmbeds('{"title": "Hi"')).toThrow("Embeds aren't valid JSON");
        expect(() => normalizeEmbeds([{ title: "Hi" }, "oops"])).toThrow("Embed 2 isn't an embed");
        expect(() => normalizeEmbeds(42)).toThrow("Embed 1 isn't an embed");
        await expect(buildMessagePayload({ content: "hi", embeds: "[{" })).rejects.toThrow("Embeds aren't valid JSON");
        expect(normalizeEmbeds('[{"title": "Hi"}]')).toEqual([{ title: "Hi" }]);
        expect(normalizeEmbeds("  ")).toEqual([]);
        expect(normalizeEmbeds(undefined)).toEqual([]);
    });
});
