// How the editor looks in a Paperboard window narrow enough that the Library
// starts collapsed (headless Chrome, the whole panel: test/fixtures/
// panelFixture.tsx, lookChecks): a project opens with the Library's list
// hidden, the console opens on whole rows, values read in either theme and
// follow a switch, and the Section menu says the section jumped to.
import { expect, test } from "bun:test";
import { panelFixture } from "./helpers/panelFixture";

test(
    "a project opens with the collapsed Library's list hidden, values follow the theme, the console shows whole rows, and the Section menu names its section",
    async () => {
        const { look } = await panelFixture();
        // the list stays hidden with the Library as its blocks come in, and leaves the Library button alone
        expect(look.opened).toEqual({ listVisible: false, listDisplay: "none", coversButton: false });
        // scrolled to the newest line, the oldest row shown is whole, right under the header
        expect(look.console.atEnd).toBe(0);
        expect(look.console.cutRow).toBeLessThanOrEqual(0.5);
        expect(look.console.underHeader).toBeGreaterThan(0);
        // light, dark, then light again, switched while the project is open
        for (const values of Object.values(look.themes) as any[]) {
            // a socket's typed-in value, and the text and number blocks' fields, are PaperUI's field
            for (const field of [values.socket, values.textBlock, values.numberBlock]) expect(field.fill).toBe(values.field);
            expect(values.socket.text).toBe(values.text);
            expect(values.numberBlock.text).toBe(values.text);
            // a block's icon sits on the block's own colour, never on what it would vanish into
            for (const block of [values.textBlock, values.numberBlock]) {
                expect(block.behind).not.toBe(values.field);
                expect(block.icon).not.toBe(block.behind);
            }
        }
        // the menu says the section jumped to, and the list went there; another list starts from none
        expect(look.section.before).toStartWith("Section");
        expect(look.section.after).toStartWith(look.section.chosen);
        expect(look.section.scrolled).toBe(true);
        expect(look.section.fresh).toStartWith("Section");
    },
    300_000,
);
