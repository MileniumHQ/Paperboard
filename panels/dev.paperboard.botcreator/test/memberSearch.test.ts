import { describe, expect, test } from "bun:test";
import type { Client } from "discord.js";
import { findMembers, MAX_FOUND_MEMBERS, MEMBER_SEARCH_TIMEOUT_MS, resolveMember, searchMembers } from "../src/discordOps";

describe("member search", () => {
    test("a page of members that never arrives ends in an error that says why", async () => {
        const asked: unknown[] = [];
        const guild = {
            members: {
                // discord.js rejects like this when the gateway never answers
                fetch: async (options: unknown) => {
                    asked.push(options);
                    throw Object.assign(new Error("Members didn't arrive in time."), { code: "GuildMembersTimeout" });
                },
            },
        };
        await expect(searchMembers(guild, "ada", 25, 4_000)).rejects.toThrow(
            "Discord didn't send the members within 4 seconds. The bot may have lost its connection to Discord; try again.",
        );
        // the wait Discord is given is the one the message names
        expect(asked).toEqual([{ query: "ada", limit: 25, time: 4_000 }]);
    });

    test("Find Members gives Discord the same bounded wait, and says so when it runs out", async () => {
        const asked: unknown[] = [];
        const guild = {
            id: "1",
            name: "Home",
            members: {
                fetch: async (options: unknown) => {
                    asked.push(options);
                    throw Object.assign(new Error("Members didn't arrive in time."), { code: "GuildMembersTimeout" });
                },
            },
        };
        const bot = { guilds: { cache: new Map([["1", guild]]) } } as unknown as Client;
        await expect(findMembers(bot, "@ada")).rejects.toThrow(`Discord didn't send the members within ${MEMBER_SEARCH_TIMEOUT_MS / 1000} seconds`);
        expect(asked).toEqual([{ query: "ada", limit: MAX_FOUND_MEMBERS, time: MEMBER_SEARCH_TIMEOUT_MS }]);
    });

    test("any other failure is Discord's own reason, not a timeout", async () => {
        const guild = { members: { fetch: () => Promise.reject(Object.assign(new Error("Missing Permissions"), { code: 50013 })) } };
        await expect(searchMembers(guild, "ada", 25)).rejects.toThrow(/^Missing Permissions$/);
    });

    test("an empty search asks for the first page, and the members come back as found", async () => {
        const found = [{ id: "1" }];
        const guild = { members: { fetch: async () => ({ values: () => found }) } };
        expect([...(await searchMembers(guild, "", 25)).values()]).toEqual(found);
    });
});

describe("finding a member without a server", () => {
    // a bot in two servers, whose member lookups fail as each says
    const bot = (...answers: (() => Promise<unknown>)[]) =>
        ({ guilds: { cache: new Map(answers.map((fetch, i) => [String(i), { members: { fetch } }])) } }) as unknown as Client;
    const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

    test("a lookup that fails for any reason but Unknown Member says that reason, not that the user is in no server", async () => {
        const lookups = bot(() => Promise.reject(discordError(50013, "Missing Permissions")), () => Promise.reject(discordError(10007, "Unknown Member")));
        await expect(resolveMember(lookups, "42")).rejects.toThrow("Missing Permissions");
    });
});
