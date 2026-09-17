// Every static trigger must expose the payload keys it emits as typed
// fields; an opaque "Data" output is exactly what the picker can't use.
import { describe, expect, it } from "bun:test";
import { staticTriggers } from "../src/service";

// the payload shape each emit site sends (attachListeners in service.ts)
const EMITTED_KEYS: Record<string, string[]> = {
    "on-message": ["content", "author", "authorId", "channelId", "guildId", "messageId"],
    "on-member-join": ["username", "userId", "guildId", "guildName"],
    "on-member-leave": ["username", "userId", "guildId"],
    "on-reaction-add": ["emoji", "userId", "username", "messageId", "channelId"],
    "on-connection-error": ["error"],
    "interaction-triggered": [
        "customId",
        "interactionId",
        "userId",
        "username",
        "channelId",
        "guildId",
        "messageId",
    ],
    "on-message-edited": ["content", "author", "authorId", "channelId", "guildId", "messageId"],
    "on-message-deleted": ["messageId", "channelId", "guildId"],
    "on-reaction-removed": ["emoji", "userId", "username", "messageId", "channelId"],
    "on-member-banned": ["userId", "username", "reason", "guildId"],
    "on-role-added": ["userId", "username", "roleId", "guildId"],
    "on-role-removed": ["userId", "username", "roleId", "guildId"],
    "on-thread-created": ["threadId", "name", "channelId", "ownerId", "guildId"],
    "on-voice-state-change": ["userId", "username", "channelId", "previousChannelId", "guildId"],
    "on-bot-ready": ["userId", "username"],
};

describe("static trigger output fields", () => {
    it("declares a typed field for every emitted payload key", () => {
        for (const [id, keys] of Object.entries(EMITTED_KEYS)) {
            const trigger = staticTriggers.find((t: any) => t.id === id);
            expect(trigger).toBeDefined();
            const fields = (trigger as any).outputFields ?? {};
            expect(Object.keys(fields).sort()).toEqual([...keys].sort());
            for (const [fieldId, field] of Object.entries<any>(fields)) {
                expect(typeof field.type).toBe("string");
                expect(field.type).not.toBe("any");
                expect(typeof field.label).toBe("string");
                expect(field.label.length).toBeGreaterThan(0);
            }
        }
    });

    it("covers every static trigger, so none falls back to an opaque output", () => {
        for (const trigger of staticTriggers as any[]) {
            expect(EMITTED_KEYS[trigger.id]).toBeDefined();
            expect(Object.keys(trigger.outputFields ?? {}).length).toBeGreaterThan(0);
        }
    });
});
