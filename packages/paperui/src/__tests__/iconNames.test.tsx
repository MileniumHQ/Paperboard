// Ligature text is not an accessible name. Icons render through a symbol
// font: "content_copy" in the DOM draws a copy glyph, but a screen reader
// (and the accessible-name computation) read the letters. Every sidebar
// item read as "dashboard Overview", and icon buttons were named after the
// glyph ("content_copy") even when they carried a title.
import { describe, test, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { PaperIcon } from "../components/PaperIcon";
import { PaperButton } from "../components/PaperButton";
import { PaperMenu, PaperMenuSection, PaperMenuItem } from "../components/PaperMenu";
import { PaperSelector, PaperSelectorItem } from "../components/PaperSelector";

afterEach(cleanup);

describe("icon accessible names", () => {
    test("an icon is decorative unless it is given a label", () => {
        render(() => (
            <>
                <PaperIcon data-testid="plain">content_copy</PaperIcon>
                <PaperIcon label="Server online">check_circle</PaperIcon>
            </>
        ));
        expect(screen.getByTestId("plain").getAttribute("aria-hidden")).toBe("true");
        expect(screen.getByRole("img", { name: "Server online" })).toBeTruthy();
        expect(screen.queryByRole("img", { name: /content_copy/ })).toBeNull();
    });

    test("an icon button is named by its title or aria-label, never its glyph", () => {
        render(() => (
            <>
                <PaperButton icon title="Copy address">
                    content_copy
                </PaperButton>
                <PaperButton icon aria-label="Close" title="Close this">
                    close
                </PaperButton>
            </>
        ));
        expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "content_copy" })).toBeNull();
    });

    test("a button with an icon and text is named by the text", () => {
        render(() => (
            <PaperButton>
                <PaperIcon>swap_vert</PaperIcon>
                Switch to Forge
            </PaperButton>
        ));
        expect(screen.getByRole("button", { name: "Switch to Forge" })).toBeTruthy();
    });

    test("menu and selector items are named by their text, not their icon", () => {
        render(() => (
            <>
                <PaperMenu name="sidebar" value="overview">
                    <PaperMenuSection title="Server">
                        <PaperMenuItem value="overview" icon="dashboard">
                            Overview
                        </PaperMenuItem>
                    </PaperMenuSection>
                </PaperMenu>
                <PaperSelector name="software" defaultValue="vanilla">
                    <PaperSelectorItem value="vanilla" icon="deployed_code">
                        Vanilla
                    </PaperSelectorItem>
                </PaperSelector>
            </>
        ));
        // exact names: before, these read "dashboard Overview" and "deployed_code Vanilla"
        expect(screen.getAllByRole("radio").length).toBe(2);
        expect(screen.getByRole("radio", { name: "Overview" })).toBeTruthy();
        expect(screen.getByRole("radio", { name: "Vanilla" })).toBeTruthy();
    });
});
