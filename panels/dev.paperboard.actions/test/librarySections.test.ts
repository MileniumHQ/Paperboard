// Library category grouping (bun test): panels name categories and can
// attach an icon and order; without an order, sections sort alphabetically.
import { describe, test, expect } from "bun:test";
import type { ActionInfo, TriggerInfo } from "@paperboard-dev/paperapi";
import {
    buildLibrarySections,
    UNCATEGORIZED_SECTION,
} from "../src/lib/librarySections";

const trigger = (
    id: string,
    category?: string | { name: string; icon?: string; order?: number },
): TriggerInfo => ({
    panelId: "dev.example",
    trigger: id,
    schema: { id, name: id, description: "", category } as any,
});

const action = (
    id: string,
    category?: string | { name: string; icon?: string; order?: number },
): ActionInfo => ({
    panelId: "dev.example",
    action: id,
    schema: { id, name: id, description: "", category } as any,
});

describe("buildLibrarySections", () => {
    test("groups by category and keeps triggers before actions", () => {
        const sections = buildLibrarySections(
            [trigger("on-message", "Messages"), trigger("on-join", "Members")],
            [action("send-message", "Messages"), action("set-status", "Bot")],
        );
        // no orders: alphabetical
        expect(sections.map((s) => s.name)).toEqual(["Bot", "Members", "Messages"]);
        const messages = sections.find((s) => s.name === "Messages")!;
        expect(messages.triggers.map((t) => t.trigger)).toEqual(["on-message"]);
        expect(messages.actions.map((a) => a.action)).toEqual(["send-message"]);
    });

    test("declared order wins; unordered categories sort after, alphabetically", () => {
        const sections = buildLibrarySections(
            [
                trigger("a", { name: "Messages", icon: "chat", order: 20 }),
                trigger("b", { name: "Members", icon: "group", order: 10 }),
                trigger("c", "Zebra"),
            ],
            [action("d", "Alpha")],
        );
        expect(sections.map((s) => s.name)).toEqual([
            "Members",
            "Messages",
            "Alpha",
            "Zebra",
        ]);
        expect(sections[0].icon).toBe("group");
    });

    test("an item naming a category inherits the declared icon/order", () => {
        const sections = buildLibrarySections(
            [trigger("a", { name: "Messages", icon: "chat", order: 1 })],
            [action("send", "Messages")],
        );
        expect(sections).toHaveLength(1);
        expect(sections[0].icon).toBe("chat");
        expect(sections[0].order).toBe(1);
        expect(sections[0].actions).toHaveLength(1);
    });

    test("uncategorized items land in the General section", () => {
        const sections = buildLibrarySections(
            [trigger("on-raw", undefined)],
            [action("do-thing", "  ")],
        );
        expect(sections).toHaveLength(1);
        expect(sections[0].name).toBe(UNCATEGORIZED_SECTION);
        expect(sections[0].triggers).toHaveLength(1);
        expect(sections[0].actions).toHaveLength(1);
    });

    test("an empty panel produces no sections", () => {
        expect(buildLibrarySections([], [])).toEqual([]);
    });
});
