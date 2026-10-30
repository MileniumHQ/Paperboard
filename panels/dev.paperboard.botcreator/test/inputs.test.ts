// what flows and agents type into the newer actions, checked before Discord
// is asked anything: a typo or an impossible poll fails with its rule
import { describe, it, expect } from "bun:test";
import { ChannelType, GuildScheduledEventEntityType } from "discord.js";
import { buildPoll, fileFromUrl, listInput, parseMoment, permissionNames } from "../src/discordOps";
import { channelPermissionChanges, scheduledEventOptions } from "../src/service";

describe("list inputs", () => {
    it("takes a list, or text with one item per line, and commas only where asked", () => {
        expect(listInput(["a", " b ", ""])).toEqual(["a", "b"]);
        expect(listInput("Chocolate chip\nOatmeal, raisin\n")).toEqual(["Chocolate chip", "Oatmeal, raisin"]);
        expect(listInput("SendMessages, ViewChannel", true)).toEqual(["SendMessages", "ViewChannel"]);
        expect(listInput(undefined)).toEqual([]);
    });
});

describe("polls", () => {
    it("builds Discord's poll, a day long unless told", () => {
        expect(buildPoll({ question: "Best cookie?", answers: "Chocolate chip\nOatmeal" })).toEqual({
            question: { text: "Best cookie?" },
            answers: [{ text: "Chocolate chip" }, { text: "Oatmeal" }],
            duration: 24,
            allowMultiselect: false,
        });
        expect(buildPoll({ question: "?", answers: ["a"], hours: 2, multiple: true })).toMatchObject({ duration: 2, allowMultiselect: true });
    });

    it("refuses what Discord would", () => {
        expect(() => buildPoll({ question: "", answers: ["a"] })).toThrow(/needs a question/);
        expect(() => buildPoll({ question: "?", answers: [] })).toThrow(/at least one answer/);
        expect(() => buildPoll({ question: "?", answers: Array.from({ length: 11 }, (_, i) => `${i}`) })).toThrow(/at most 10/);
        expect(() => buildPoll({ question: "?", answers: ["x".repeat(56)] })).toThrow(/55 characters/);
        expect(() => buildPoll({ question: "?", answers: ["a"], hours: 0 })).toThrow(/1 to 768/);
    });
});

describe("files", () => {
    it("sends from web addresses only", () => {
        expect(fileFromUrl("https://example.com/cookie.png")).toEqual({ attachment: "https://example.com/cookie.png" });
        expect(fileFromUrl("https://example.com/a", " recipe.pdf ")).toEqual({ attachment: "https://example.com/a", name: "recipe.pdf" });
        expect(() => fileFromUrl("/home/me/.ssh/id_ed25519")).toThrow(/isn't a web address/);
        expect(() => fileFromUrl("file:///etc/passwd")).toThrow(/http or https/);
    });
});

describe("permissions", () => {
    it("names Discord's permissions, and a typo is refused", () => {
        expect(permissionNames("SendMessages, ViewChannel")).toEqual(["SendMessages", "ViewChannel"]);
        expect(() => permissionNames(["SendMesages"])).toThrow("Unknown Discord permission(s): SendMesages");
    });

    it("allows, denies and resets in one overwrite", () => {
        expect(channelPermissionChanges({ allow: "ViewChannel", deny: ["SendMessages"], reset: "AttachFiles" })).toEqual({
            ViewChannel: true,
            SendMessages: false,
            AttachFiles: null,
        });
        expect(() => channelPermissionChanges({ allow: "SendMessages", deny: "SendMessages" })).toThrow(/more than one list/);
        expect(() => channelPermissionChanges({})).toThrow(/at least one permission/);
    });
});

describe("scheduled events", () => {
    const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
    const voice = { id: "300000000000000009", type: ChannelType.GuildVoice };
    const bot = { channels: { fetch: async (id: string) => (id === voice.id ? voice : { id, type: ChannelType.GuildText }) } } as any;

    it("is in a voice channel, or somewhere with an end", async () => {
        expect(await scheduledEventOptions(bot, { name: "Bake-off", start: later(1), channel: voice.id })).toMatchObject({
            entityType: GuildScheduledEventEntityType.Voice,
            channel: voice.id,
        });
        expect(await scheduledEventOptions(bot, { name: "Bake-off", start: later(1), end: later(2), location: "Kitchen" })).toMatchObject({
            entityType: GuildScheduledEventEntityType.External,
            entityMetadata: { location: "Kitchen" },
        });
    });

    it("says what's missing or wrong", async () => {
        await expect(scheduledEventOptions(bot, { name: "x", start: later(1), location: "Kitchen" })).rejects.toThrow(/needs an end/);
        await expect(scheduledEventOptions(bot, { name: "x", start: later(1), end: later(2) })).rejects.toThrow(/needs a location/);
        await expect(scheduledEventOptions(bot, { name: "x", start: later(-1), channel: voice.id })).rejects.toThrow(/in the future/);
        await expect(scheduledEventOptions(bot, { name: "x", start: later(2), end: later(1), location: "K" })).rejects.toThrow(/ends after/);
        await expect(scheduledEventOptions(bot, { name: "x", start: later(1), channel: "300000000000000001" })).rejects.toThrow(/voice or stage/);
        expect(() => parseMoment("next tuesday", "Starts")).toThrow(/Starts is a date and time/);
    });
});
