import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import {
    PaperCheckbox,
    PaperInput,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperToggle,
} from "../index";

function Controls() {
    return (
        <>
            <PaperSettingItem title="Notifications">
                <PaperToggle name="notify" aria-label="Notifications" />
            </PaperSettingItem>
            <PaperSettingItem title="Agree">
                <PaperCheckbox name="agree" aria-label="Agree" />
            </PaperSettingItem>
            <PaperSettingItem title="Nickname">
                <PaperInput name="nick" aria-label="Nickname" />
            </PaperSettingItem>
            <PaperSettingItem title="Mode">
                <PaperSelectMenu name="mode">
                    <PaperSelectMenuItem value="easy">Easy</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="hard">Hard</PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperSettingItem>
        </>
    );
}

const switchEl = () => screen.getByRole("switch");
const checkboxEl = () => document.querySelector<HTMLElement>('div[role="checkbox"]')!;
const nick = () => screen.getByLabelText("Nickname") as HTMLInputElement;
const modeTrigger = () => screen.getByRole("button", { name: /Easy|Hard|Select/ });

// Inventory: Menus and form controls — Setting list record.
describe("PaperSettingList record", () => {
    test("defaultValue fills named toggles, checkboxes, inputs and select menus", () => {
        render(() => (
            <PaperSettingList defaultValue={{ notify: true, agree: false, nick: "pxl", mode: "hard" }}>
                <Controls />
            </PaperSettingList>
        ));
        expect(switchEl().getAttribute("aria-checked")).toBe("true");
        expect(checkboxEl().getAttribute("aria-checked")).toBe("false");
        expect(nick().value).toBe("pxl");
        expect(modeTrigger().textContent).toContain("Hard");
    });

    test("a controlled value refills the controls when it changes", () => {
        const [value, setValue] = createSignal<Record<string, unknown>>({ notify: false, agree: true, nick: "a", mode: "easy" });
        render(() => (
            <PaperSettingList value={value()}>
                <Controls />
            </PaperSettingList>
        ));
        expect(switchEl().getAttribute("aria-checked")).toBe("false");
        expect(checkboxEl().getAttribute("aria-checked")).toBe("true");

        setValue({ notify: true, agree: false, nick: "b", mode: "hard" });
        expect(switchEl().getAttribute("aria-checked")).toBe("true");
        expect(checkboxEl().getAttribute("aria-checked")).toBe("false");
        expect(nick().value).toBe("b");
        expect(modeTrigger().textContent).toContain("Hard");
    });

    test("a value of the wrong type throws naming the key, the value and the type expected", () => {
        expect(() =>
            render(() => (
                <PaperSettingList defaultValue={{ notify: "yes" }}>
                    <PaperToggle name="notify" />
                </PaperSettingList>
            )),
        ).toThrow(/"notify" is string "yes", but a PaperToggle takes a boolean/);

        expect(() =>
            render(() => (
                <PaperSettingList defaultValue={{ mode: true }}>
                    <PaperSelectMenu name="mode">
                        <PaperSelectMenuItem value="easy">Easy</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </PaperSettingList>
            )),
        ).toThrow(/"mode" is boolean true, but a PaperSelectMenu takes a string or a number/);
    });

    test("one edit calls onValueChange exactly once with the whole record", () => {
        const records: Record<string, unknown>[] = [];
        render(() => (
            <PaperSettingList
                defaultValue={{ notify: false, agree: false, nick: "pxl", mode: "easy" }}
                onValueChange={(record) => records.push(record)}
            >
                <Controls />
            </PaperSettingList>
        ));

        fireEvent.click(switchEl());
        expect(records).toEqual([{ notify: true, agree: false, nick: "pxl", mode: "easy" }]);

        fireEvent.click(checkboxEl());
        expect(records.at(-1)).toEqual({ notify: true, agree: true, nick: "pxl", mode: "easy" });
        expect(records).toHaveLength(2);

        // a text field fires input and then change for the same edit
        nick().value = "pxlkt";
        fireEvent.input(nick());
        fireEvent.change(nick());
        expect(records).toHaveLength(3);
        expect(records.at(-1)).toEqual({ notify: true, agree: true, nick: "pxlkt", mode: "easy" });

        fireEvent.click(modeTrigger());
        fireEvent.click(screen.getByRole("option", { name: "Hard" }));
        expect(records).toHaveLength(4);
        expect(records.at(-1)).toEqual({ notify: true, agree: true, nick: "pxlkt", mode: "hard" });
    });
});
