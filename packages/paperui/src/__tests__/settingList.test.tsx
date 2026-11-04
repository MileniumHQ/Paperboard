import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperSettingItem, PaperSettingList } from "../templates/PaperSettingList";
import { PaperToggle } from "../components/PaperToggle";
import { PaperCheckbox } from "../components/PaperCheckbox";
import { PaperInput } from "../components/PaperInput";
import { PaperSelectMenu, PaperSelectMenuItem } from "../components/PaperSelectMenu";

describe("PaperSettingList record", () => {
    test("defaultValue fills the named controls", () => {
        render(() => (
            <PaperSettingList defaultValue={{ secure: true, verbose: true, host: "localhost", mode: "b" }}>
                <PaperSettingItem title="Secure">
                    <PaperToggle name="secure" aria-label="Secure" />
                </PaperSettingItem>
                <PaperSettingItem title="Verbose">
                    <PaperCheckbox name="verbose" label="Verbose" />
                </PaperSettingItem>
                <PaperSettingItem title="Host">
                    <PaperInput name="host" label="Host" />
                </PaperSettingItem>
                <PaperSettingItem title="Mode">
                    <PaperSelectMenu name="mode">
                        <PaperSelectMenuItem value="a">Mode A</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="b">Mode B</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </PaperSettingItem>
            </PaperSettingList>
        ));
        expect(screen.getByRole("switch", { name: "Secure" }).getAttribute("aria-checked")).toBe("true");
        const verbose = screen.getAllByRole("checkbox", { name: /Verbose/ }).find((el) => el.tagName === "DIV")!;
        expect(verbose.getAttribute("aria-checked")).toBe("true");
        expect((screen.getByRole("textbox", { name: "Host" }) as HTMLInputElement).value).toBe("localhost");
        expect(within(screen.getByRole("button", { name: /Mode/ })).getByText("Mode B")).toBeDefined();
    });

    test("value follows its source, and a control's own prop wins", () => {
        const [values, setValues] = createSignal<Record<string, unknown>>({ secure: false, host: "a" });
        render(() => (
            <PaperSettingList value={values()}>
                <PaperToggle name="secure" aria-label="Secure" />
                <PaperInput name="host" label="Host" />
                <PaperToggle name="pinned" aria-label="Pinned" checked />
            </PaperSettingList>
        ));
        setValues({ secure: true, host: "b", pinned: false });
        expect(screen.getByRole("switch", { name: "Secure" }).getAttribute("aria-checked")).toBe("true");
        expect((screen.getByRole("textbox", { name: "Host" }) as HTMLInputElement).value).toBe("b");
        expect(screen.getByRole("switch", { name: "Pinned" }).getAttribute("aria-checked")).toBe("true");
    });

    test("a value of the wrong type for its control is an error", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() =>
            render(() => (
                <PaperSettingList defaultValue={{ secure: "yes" }}>
                    <PaperToggle name="secure" aria-label="Secure" />
                </PaperSettingList>
            )),
        ).toThrow(/"secure" is string "yes", but a PaperToggle takes a boolean/);
        vi.restoreAllMocks();
    });

    test("one edit calls onValueChange once", () => {
        const onValueChange = vi.fn();
        render(() => (
            <PaperSettingList onValueChange={onValueChange}>
                <PaperToggle name="secure" aria-label="Secure" />
                <PaperInput name="host" label="Host" />
            </PaperSettingList>
        ));
        fireEvent.click(screen.getByRole("switch", { name: "Secure" }));
        expect(onValueChange).toHaveBeenCalledTimes(1);
        expect(onValueChange).toHaveBeenLastCalledWith({ secure: true });

        const host = screen.getByRole("textbox", { name: "Host" }) as HTMLInputElement;
        host.value = "example.com";
        fireEvent.input(host);
        // the blur that follows typing fires change with the same value
        fireEvent.change(host);
        expect(onValueChange).toHaveBeenCalledTimes(2);
        expect(onValueChange).toHaveBeenLastCalledWith({ secure: true, host: "example.com" });
    });
});
