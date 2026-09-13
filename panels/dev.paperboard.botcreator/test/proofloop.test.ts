// proof-of-loop evidence (bun test): the recent-message buffer caps at ten
// entries per session, and guild summaries come straight from client cache
import { describe, it, expect, beforeEach } from "bun:test";
import type { Client } from "discord.js";
import {
    RECENT_MESSAGE_CAP,
    recordRecentMessage,
    getRecentMessages,
    clearRecentMessages,
    listGuilds,
    buildBotInfo,
} from "../src/service";

function fakeMessage(n: number) {
    return {
        content: `msg ${n}`,
        author: "alice",
        authorId: "u1",
        channelId: "c1",
        guildId: "g1",
        messageId: `m${n}`,
    };
}

describe("recent message ring buffer", () => {
    beforeEach(() => {
        clearRecentMessages();
    });

    it(`caps at ${RECENT_MESSAGE_CAP} entries, oldest dropped first`, () => {
        for (let n = 1; n <= RECENT_MESSAGE_CAP + 2; n++) {
            recordRecentMessage(fakeMessage(n));
        }
        const kept = getRecentMessages();
        expect(kept).toHaveLength(RECENT_MESSAGE_CAP);
        expect(kept[0].messageId).toBe("m3");
        expect(kept[kept.length - 1].messageId).toBe(`m${RECENT_MESSAGE_CAP + 2}`);
    });

    it("clears between sessions", () => {
        recordRecentMessage(fakeMessage(1));
        clearRecentMessages();
        expect(getRecentMessages()).toEqual([]);
    });
});

describe("guild summaries from client cache", () => {
    const fakeClient = {
        user: {
            username: "TestBot",
            tag: "TestBot#1",
            id: "app1",
            displayAvatarURL: () => "https://cdn/avatar.png",
        },
        guilds: {
            cache: new Map([
                [
                    "g1",
                    {
                        id: "g1",
                        name: "Guild One",
                        channels: {
                            cache: new Map([
                                ["c1", { id: "c1", name: "general", type: 0 }],
                                ["c2", { id: "c2", name: "voice", type: 2 }],
                            ]),
                        },
                    },
                ],
            ]),
        },
    } as unknown as Client;

    it("lists guilds with text channels only", () => {
        const guilds = listGuilds(fakeClient);
        expect(guilds).toHaveLength(1);
        expect(guilds[0].name).toBe("Guild One");
        expect(guilds[0].channels).toEqual([{ id: "c1", name: "general" }]);
    });

    it("returns no guilds without a client", () => {
        expect(listGuilds(null)).toEqual([]);
    });

    it("buildBotInfo carries guilds and recent messages", () => {
        recordRecentMessage(fakeMessage(7));
        const info = buildBotInfo(fakeClient);
        expect(info.guildCount).toBe(1);
        expect(info.guilds).toHaveLength(1);
        expect(info.recentMessages).toHaveLength(1);
        expect(info.recentMessages[0].messageId).toBe("m7");
        clearRecentMessages();
    });
});
