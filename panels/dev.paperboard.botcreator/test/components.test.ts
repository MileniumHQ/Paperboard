// Message components and the parameterized interaction triggers (bun test,
// hermetic): Discord's per-value limits are declared on the action inputs
// (the SDK refuses a call that breaks one; the editor shows it first), the
// builders check presence, kinds and how inputs relate, the
// Components field lays buttons, select menus and Interaction Rows out into
// rows, and clicks and modal submits route by id through the match rule.
import { describe, expect, it } from "bun:test";
import {
    buildButtonComponent,
    buildComponentRow,
    buildModalField,
    buildModalPayload,
    buildSelectMenuComponent,
    componentsToActionRows,
    layoutComponentRows,
    componentClickPayload,
    modalSubmitPayload,
} from "../src/discordOps";
import { ComponentType, TextInputStyle } from "discord.js";
import { staticTriggers, actions } from "../src/service";
import { INPUTS } from "../src/discordOps";
import { checkActionInput, validateActionDefinition } from "@mileniumhq/paperapi";

/** The limit an action's input declares, as the SDK applies it on a call. */
const limit = (actionId: string, key: string, value: unknown) =>
    checkActionInput((actions.find((a) => a.id === actionId) as any).inputs[key], value);

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
        expect(component).toEqual({
            kind: "button",
            label: "Roll",
            style: "primary",
            customId: "roll-dice",
        });
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
        expect(limit("create-button", "label", "x".repeat(81))).toMatch(/at most 80 characters/);
        expect(limit("create-button", "label", "x".repeat(80))).toBeUndefined();
    });

    it("a non-link button needs an interaction id", () => {
        expect(() => buildButtonComponent({ label: "Roll" })).toThrow(/needs an Interaction ID/);
    });

    it("an interaction id beyond 100 characters is refused", () => {
        for (const [action, key] of [
            ["create-button", "customId"],
            ["create-select-menu", "customId"],
            ["show-modal", "modalId"],
        ]) {
            expect(limit(action, key, "x".repeat(101))).toMatch(/at most 100 characters/);
        }
    });

    it("a link button needs a URL and needs no interaction id", () => {
        const component = buildButtonComponent({ label: "Docs", style: "link", url: "https://example.com" });
        expect(component.url).toBe("https://example.com");
        expect(() => buildButtonComponent({ label: "Docs", style: "link" })).toThrow(/needs a URL/);
    });
});

const button = (id: string) => buildButtonComponent({ label: id, customId: id });
const menu = (id: string) => buildSelectMenuComponent({ customId: id, options: ["Red", "Green"] });
const ids = (rows: { customId?: string }[][]) => rows.map((row) => row.map((c) => c.customId));

describe("component row layout", () => {
    it("wraps a single component and lays nothing out for an empty field", () => {
        expect(ids(layoutComponentRows(button("a")))).toEqual([["a"]]);
        expect(layoutComponentRows(undefined)).toEqual([]);
    });

    it("loose buttons share a row and start a new one past five", () => {
        const six = ["1", "2", "3", "4", "5", "6"].map(button);
        expect(ids(layoutComponentRows(six))).toEqual([["1", "2", "3", "4", "5"], ["6"]]);
    });

    it("an Interaction Row keeps its own row; loose components around it get new rows", () => {
        const row = buildComponentRow([button("r1"), button("r2")]);
        const rows = layoutComponentRows([button("a"), row, button("b"), button("c")]);
        expect(ids(rows)).toEqual([["a"], ["r1", "r2"], ["b", "c"]]);
    });

    it("a loose select menu takes a whole row", () => {
        const rows = layoutComponentRows([button("a"), menu("pick"), button("b")]);
        expect(ids(rows)).toEqual([["a"], ["pick"], ["b"]]);
    });

    it("refuses a sixth row, duplicate ids, and values that are not components", () => {
        const rows = ["1", "2", "3", "4", "5", "6"].map(menu);
        expect(() => layoutComponentRows(rows)).toThrow(/at most 5 rows/);
        expect(() => layoutComponentRows([button("a"), button("a")])).toThrow(/unique/);
        expect(() => layoutComponentRows("button" as unknown)).toThrow(/Create Button/);
        expect(() => layoutComponentRows([null])).toThrow(/Create Button/);
    });

    it("emits Discord action rows with each component's API type", () => {
        const rows = componentsToActionRows([button("a"), menu("pick")]);
        expect(rows.map((r) => r.type)).toEqual([ComponentType.ActionRow, ComponentType.ActionRow]);
        expect(rows[0].components[0]).toMatchObject({ type: ComponentType.Button, custom_id: "a" });
        expect(rows[1].components[0]).toMatchObject({
            type: ComponentType.StringSelect,
            custom_id: "pick",
            options: [
                { label: "Red", value: "Red" },
                { label: "Green", value: "Green" },
            ],
        });
    });
});

describe("Interaction Row", () => {
    it("holds one to five buttons or exactly one select menu", () => {
        expect(buildComponentRow([button("a"), button("b")]).components).toHaveLength(2);
        expect(buildComponentRow(menu("pick")).components).toHaveLength(1);
        expect(() => buildComponentRow([])).toThrow(/at least one/);
        expect(() => buildComponentRow(["1", "2", "3", "4", "5", "6"].map(button))).toThrow(/at most 5/);
        expect(() => buildComponentRow([menu("pick"), button("a")])).toThrow(/whole row/);
    });

    it("cannot hold another row", () => {
        const inner = buildComponentRow([button("a")]);
        expect(() => buildComponentRow([inner])).toThrow(/another Interaction Row/);
    });
});

describe("Create Select Menu", () => {
    it("takes listed options, or a lone value as one option", () => {
        expect(menu("pick").options).toEqual(["Red", "Green"]);
        expect(
            buildSelectMenuComponent({ customId: "x", options: ["A", " B "] }).options,
        ).toEqual(["A", "B"]);
        // text with a comma is one option, not two
        expect(buildSelectMenuComponent({ customId: "x", options: "Yes, please" }).options).toEqual([
            "Yes, please",
        ]);
    });

    it("user, role and channel menus need no options", () => {
        const users = buildSelectMenuComponent({ customId: "who", menu: "user" });
        expect(componentsToActionRows(users)[0].components[0]).toMatchObject({
            type: ComponentType.UserSelect,
            custom_id: "who",
        });
    });

    it("enforces Discord's limits", () => {
        expect(() => buildSelectMenuComponent({ options: "A" })).toThrow(/Interaction ID/);
        expect(() => buildSelectMenuComponent({ customId: "x" })).toThrow(/at least one option/);
        expect(
            limit("create-select-menu", "options", Array.from({ length: 26 }, (_, i) => `o${i}`)),
        ).toMatch(/at most 25 items/);
        expect(limit("create-select-menu", "options", ["ok", "x".repeat(101)])).toMatch(
            /Item 2 of "Options" holds at most 100 characters/,
        );
        expect(limit("create-select-menu", "placeholder", "x".repeat(151))).toMatch(/at most 150/);
        expect(limit("create-select-menu", "minValues", 26)).toMatch(/at most 25/);
        expect(limit("create-select-menu", "maxValues", 0)).toMatch(/at least 1/);
        expect(limit("create-select-menu", "maxValues", 1.5)).toMatch(/whole number/);
        expect(() => buildSelectMenuComponent({ customId: "x", options: ["A", "A"] })).toThrow(/unique/);
        expect(() =>
            buildSelectMenuComponent({ customId: "x", options: ["A", "B"], minValues: 2, maxValues: 1 }),
        ).toThrow(/Minimum picks/);
        expect(() =>
            buildSelectMenuComponent({ customId: "x", options: "A", maxValues: 2 }),
        ).toThrow(/more than the 1 options/);
        expect(() => buildSelectMenuComponent({ customId: "x", menu: "emoji" })).toThrow(/Unknown menu kind/);
    });
});

describe("modals", () => {
    it("numbers fields in order so answers arrive as Field 1, Field 2…", () => {
        const modal = buildModalPayload({
            modalId: "apply",
            title: "Apply",
            fields: [
                buildModalField({ label: "Name" }),
                buildModalField({ label: "Why?", style: "paragraph", required: false, maxLength: 500 }),
            ],
        });
        expect(modal.custom_id).toBe("apply");
        expect(modal.components.map((row) => row.components[0])).toEqual([
            { type: ComponentType.TextInput, custom_id: "field1", label: "Name", style: TextInputStyle.Short, required: true },
            {
                type: ComponentType.TextInput,
                custom_id: "field2",
                label: "Why?",
                style: TextInputStyle.Paragraph,
                required: false,
                max_length: 500,
            },
        ]);
    });

    it("enforces Discord's modal limits", () => {
        const field = buildModalField({ label: "Q" });
        expect(() => buildModalPayload({ title: "T", fields: [field] })).toThrow(/Interaction ID/);
        expect(() => buildModalPayload({ modalId: "m", fields: [field] })).toThrow(/title/);
        expect(() => buildModalPayload({ modalId: "m", title: "T" })).toThrow(/at least one/);
        expect(limit("show-modal", "fields", Array(6).fill(field))).toMatch(/at most 5 items/);
        expect(limit("show-modal", "title", "x".repeat(46))).toMatch(/at most 45/);
        expect(() => buildModalPayload({ modalId: "m", title: "T", fields: [button("a")] })).toThrow(/Create Text Field/);
        expect(() => buildModalPayload({ modalId: "m", title: "T", fields: ["text"] })).toThrow(/Create Text Field/);
        expect(limit("create-text-field", "label", "x".repeat(46))).toMatch(/at most 45/);
        expect(limit("create-text-field", "placeholder", "x".repeat(101))).toMatch(/at most 100/);
        expect(limit("create-text-field", "value", "x".repeat(4001))).toMatch(/at most 4000/);
        expect(limit("create-text-field", "maxLength", 4001)).toMatch(/at most 4000/);
        expect(limit("create-text-field", "minLength", -1)).toMatch(/at least 0/);
        expect(() => buildModalField({ label: "Q", minLength: 10, maxLength: 5 })).toThrow(/Minimum length/);
    });

    it("a submit carries each field's answer by position", () => {
        const answers = new Map([
            ["field1", { value: "Amy" }],
            ["field2", { value: "Because" }],
        ]);
        const payload = modalSubmitPayload({
            customId: "apply",
            id: "inter_9",
            user: { id: "u1", username: "amy" },
            channelId: "c1",
            guildId: "g1",
            message: null,
            fields: { fields: answers },
        } as any);
        expect(payload).toMatchObject({
            modalId: "apply",
            interactionId: "inter_9",
            messageId: "",
            field1: "Amy",
            field2: "Because",
            field3: "",
        });
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
            isAnySelectMenu: () => false,
        } as unknown as Parameters<typeof componentClickPayload>[0];
        expect(componentClickPayload(interaction)).toEqual({
            customId: "roll-dice",
            interactionId: "inter_1",
            userId: "u1",
            username: "amy",
            channelId: "c1",
            guildId: "g1",
            messageId: "m1",
            values: [],
            value: "",
        });
    });

    it("carries a select menu's picks", () => {
        const pick = {
            customId: "colour",
            id: "inter_2",
            user: { id: "u1", username: "amy" },
            channelId: "c1",
            guildId: "g1",
            message: { id: "m1" },
            isAnySelectMenu: () => true,
            values: ["Red", "Green"],
        } as unknown as Parameters<typeof componentClickPayload>[0];
        expect(componentClickPayload(pick)).toMatchObject({ values: ["Red", "Green"], value: "Red" });
    });
});

describe("the modal trigger", () => {
    const trigger = staticTriggers.find((t: any) => t.id === "modal-submitted");

    it("routes by modal id through the schema match", () => {
        expect((trigger as any).match).toEqual({ field: "modalId", input: "modalId" });
        expect(() => validateActionDefinition(trigger as any)).not.toThrow();
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

describe("interaction responses carry buttons", () => {
    const rollButton = { label: "Roll", style: "primary", customId: "roll-dice" };

    function fakeInteraction() {
        const calls: Record<string, unknown[]> = {};
        return {
            calls,
            interaction: {
                id: "inter_1",
                deferred: false,
                replied: false,
                reply: async (body: unknown) => {
                    (calls.reply ??= []).push(body);
                },
                editReply: async (body: unknown) => {
                    (calls.editReply ??= []).push(body);
                },
                followUp: async (body: unknown) => {
                    (calls.followUp ??= []).push(body);
                    return { id: "m1" };
                },
            } as any,
        };
    }

    it("respond includes the component row instead of dropping it", async () => {
        const { InteractionOps } = await import("../src/discordOps");
        const { interaction, calls } = fakeInteraction();
        const ops = new InteractionOps(() => interaction);
        await ops.respond("inter_1", { content: "Pick one", components: [rollButton] });
        const body = calls.reply[0] as any;
        expect(body.content).toBe("Pick one");
        expect(body.components).toHaveLength(1);
    });

    it("followUp includes the component row instead of dropping it", async () => {
        const { InteractionOps } = await import("../src/discordOps");
        const { interaction, calls } = fakeInteraction();
        interaction.replied = true; // a follow-up comes after the answer
        const ops = new InteractionOps(() => interaction);
        await ops.followUp("inter_1", { content: "More", components: [rollButton] });
        const body = calls.followUp[0] as any;
        expect(body.components).toHaveLength(1);
    });
});
