// Component buttons and the parameterized interaction trigger (bun test,
// hermetic): Create Button validates Discord's hard limits up front, Send
// Message accepts a single row of at most five buttons, and the click
// trigger routes by custom id through the generic match rule.
import { describe, expect, it } from "bun:test";
import {
    buildButtonComponent,
    normalizeComponents,
    componentClickPayload,
    type DiscordComponentData,
} from "../src/discordOps";
import { staticTriggers, actions } from "../src/service";
import { INPUTS } from "../src/discordOps";
import { validateActionDefinition } from "@paperboard-dev/paperapi";

const WRITING_ACTIONS = [
    "send-message",
    "send-dm",
    "respond-to-interaction",
    "follow-up-interaction",
    "edit-message",
] as const;

describe("unified message-writing actions", () => {
    const defs = () =>
        Object.fromEntries(WRITING_ACTIONS.map((id) => [id, actions.find((a: any) => a.id === id)]));

    it("every writing action shares one body vocabulary (content, embeds, components)", () => {
        const d = defs();
        for (const id of WRITING_ACTIONS) {
            expect(d[id], id).toBeDefined();
            for (const field of ["content", "embeds", "components"] as const) {
                const spec = (d[id] as any).inputs?.[field];
                expect(spec, `${id}.${field}`).toBeDefined();
                expect(spec.type, `${id}.${field}`).toBe((INPUTS as any)[field].type);
                expect(spec.label, `${id}.${field}`).toBe((INPUTS as any)[field].label);
                expect(spec.placeholder, `${id}.${field}`).toBe((INPUTS as any)[field].placeholder);
            }
        }
    });

    it("content is part of every template's main clause", () => {
        const d = defs();
        expect(d["send-message"]!.template).toBe("Send message {content} to {channel}");
        expect(d["send-dm"]!.template).toBe("Send DM {content} to {user}");
        expect(d["edit-message"]!.template).toBe("Edit message {message} to {content}");
        expect(d["respond-to-interaction"]!.template).toBe("Respond to interaction {interactionId} with {content}");
        expect(d["follow-up-interaction"]!.template).toBe("Follow up to interaction {interactionId} with {content}");
    });

    it("bulk delete is named purge", () => {
        expect(actions.find((a: any) => a.id === "purge-messages")).toBeDefined();
        expect(actions.find((a: any) => a.id === "bulk-delete-messages")).toBeUndefined();
    });
});

describe("buildButtonComponent", () => {
    it("builds a custom-id button and keeps the author's interaction id", () => {
        const component = buildButtonComponent({
            label: "Roll",
            style: "primary",
            customId: "roll-dice",
        });
        expect(component).toEqual({ label: "Roll", style: "primary", customId: "roll-dice" });
    });

    it("default style is primary; whitespace is trimmed", () => {
        const component = buildButtonComponent({ label: "  Hi  ", customId: " hi " });
        expect(component.style).toBe("primary");
        expect(component.label).toBe("Hi");
        expect(component.customId).toBe("hi");
    });

    it("refuses an unknown style", () => {
        expect(() => buildButtonComponent({ label: "X", style: "blurple" })).toThrow(/Unknown button style/);
    });

    it("refuses a missing or over-long label (Discord caps at 80)", () => {
        expect(() => buildButtonComponent({ label: "  ", customId: "x" })).toThrow(/needs a label/);
        expect(() => buildButtonComponent({ label: "x".repeat(81), customId: "x" })).toThrow(/needs a label/);
    });

    it("a non-link button needs an interaction id", () => {
        expect(() => buildButtonComponent({ label: "Roll" })).toThrow(/needs an Interaction ID/);
    });

    it("an interaction id beyond 100 characters is refused", () => {
        expect(() =>
            buildButtonComponent({ label: "Roll", customId: "x".repeat(101) }),
        ).toThrow(/100-character limit/);
    });

    it("a link button needs a URL and needs no interaction id", () => {
        const component = buildButtonComponent({ label: "Docs", style: "link", url: "https://example.com" });
        expect(component.url).toBe("https://example.com");
        expect(() => buildButtonComponent({ label: "Docs", style: "link" })).toThrow(/needs a URL/);
    });
});

describe("normalizeComponents", () => {
    it("wraps a single component and passes lists through", () => {
        const button = buildButtonComponent({ label: "B", customId: "b" });
        expect(normalizeComponents(button)).toHaveLength(1);
        expect(normalizeComponents([button, button])).toHaveLength(2);
        expect(normalizeComponents(undefined)).toEqual([]);
    });

    it("refuses non-component values instead of sending garbage", () => {
        expect(() => normalizeComponents("button" as unknown)).toThrow(/Create Button/);
        expect(() => normalizeComponents([null])).toThrow(/Create Button/);
    });

    it("enforces Discord's five-per-row cap loudly", () => {
        const buttons = Array.from({ length: 6 }, (_, i) =>
            buildButtonComponent({ label: `B${i}`, customId: `id-${i}` }),
        );
        expect(() => normalizeComponents(buttons as unknown as DiscordComponentData)).toThrow(/at most 5/);
    });
});

describe("componentClickPayload", () => {
    it("extracts the routing id and typed context from a click", () => {
        const interaction = {
            customId: "roll-dice",
            id: "inter_1",
            user: { id: "u1", username: "amy" },
            channelId: "c1",
            guildId: "g1",
            message: { id: "m1" },
        } as unknown as Parameters<typeof componentClickPayload>[0];
        expect(componentClickPayload(interaction)).toEqual({
            customId: "roll-dice",
            interactionId: "inter_1",
            userId: "u1",
            username: "amy",
            channelId: "c1",
            guildId: "g1",
            messageId: "m1",
        });
    });
});

describe("the interaction trigger", () => {
    const trigger = staticTriggers.find((t: any) => t.id === "interaction-triggered");

    it("routes by custom id: the schema match pairs the input with the payload field", () => {
        expect(trigger).toBeDefined();
        expect(trigger.inputs?.customId).toBeDefined();
        expect((trigger as any).match).toEqual({ field: "customId", input: "customId" });
        // one definition contract, validated by the same validator register uses
        expect(() => validateActionDefinition(trigger as any)).not.toThrow();
    });

    it("declares a typed field for the button's custom id", () => {
        expect(trigger.outputFields?.customId?.type).toBe("string");
        expect(trigger.outputFields?.interactionId?.type).toBe("discord-interaction");
    });
});
