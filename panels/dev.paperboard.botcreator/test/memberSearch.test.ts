import { describe, expect, test } from "bun:test";
import { searchMembers } from "../src/discordOps";

describe("member search", () => {
    test("a page of members that never arrives ends in an error that says why", async () => {
        const asked: unknown[] = [];
        const guild = {
            members: {
                // discord.js rejects like this when the gateway never answers
                fetch: async (options: unknown) => {
                    asked.push(options);
                    throw new Error("Members didn't arrive in time.");
                },
            },
        };
        await expect(searchMembers(guild, "ada", 25, 4_000)).rejects.toThrow(
            "Discord didn't send the members within 4 seconds. The bot may have lost its connection to Discord; try again. (Members didn't arrive in time.)",
        );
        // the wait Discord is given is the one the message names
        expect(asked).toEqual([{ query: "ada", limit: 25, time: 4_000 }]);
    });

    test("an empty search asks for the first page, and the members come back as found", async () => {
        const found = [{ id: "1" }];
        const guild = { members: { fetch: async () => ({ values: () => found }) } };
        expect([...(await searchMembers(guild, "", 25)).values()]).toEqual(found);
    });
});
