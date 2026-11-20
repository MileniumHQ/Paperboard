// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const OUTPUT = '[class*="_outputArea_"]';
const ROWS = '[class*="_entry_"]';

interface View {
    mounted: number;
    atBottom: boolean;
    /** the text of the row at the top edge of the viewport */
    top: string | null;
    /** whether the row with this text is mounted and inside the viewport */
    shows: boolean;
    scrollTop: number;
}

const view = (line: string) =>
    page.eval<View>(`(() => {
        const out = document.querySelector('${OUTPUT}');
        const box = out.getBoundingClientRect();
        const rows = [...out.querySelectorAll('${ROWS}')];
        const row = rows.find((r) => r.textContent === ${JSON.stringify(line)});
        const r = row?.getBoundingClientRect();
        return {
            mounted: rows.length,
            atBottom: out.scrollHeight - out.clientHeight - out.scrollTop <= 2,
            top: document.elementFromPoint(box.left + 40, box.top + 4)?.closest('${ROWS}')?.textContent ?? null,
            shows: !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
            scrollTop: out.scrollTop,
        };
    })()`);

const showing = (line: string) =>
    page.waitFor(
        `(() => { const out = document.querySelector('${OUTPUT}'); const box = out.getBoundingClientRect();
            const row = [...out.querySelectorAll('${ROWS}')].find((r) => r.textContent === ${JSON.stringify(line)});
            const r = row?.getBoundingClientRect(); return !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1
                && out.scrollHeight - out.clientHeight - out.scrollTop <= 2; })()`,
        `"${line}" to show at the bottom of the console`,
    );

// Inventory: Content, files and console — Console stays windowed and stable.
describe("PaperConsole windowing", () => {
    test("a 5000-line console mounts only a window and follows the tail", async () => {
        page = await browser.open("console", { query: "lines=5000" });
        await showing("line 4999");
        const v = await view("line 4999");
        expect(v.mounted).toBeGreaterThan(0);
        expect(v.mounted).toBeLessThan(200);
    });

    test("a 3000-line burst stays windowed and on the tail", async () => {
        page = await browser.open("console", { query: "lines=50" });
        await showing("line 49");
        await page.eval("t.append(3000)");
        await showing("line 3049");
        expect((await view("line 3049")).mounted).toBeLessThan(200);
    });

    test("scrolling up holds the reader's place while new lines arrive", async () => {
        page = await browser.open("console", { query: "lines=2000" });
        await showing("line 1999");
        const box = await page.center(OUTPUT);
        await page.wheel(box, -3000);
        await page.waitFor(`document.querySelector('${OUTPUT}').scrollTop < document.querySelector('${OUTPUT}').scrollHeight - 2000`, "the console to scroll up");
        // settled: the window has re-measured the rows it scrolled onto
        await page.frames();
        const before = await view("line 1999");
        expect(before.top).not.toBeNull();

        const height = await page.eval<number>(`document.querySelector('${OUTPUT}').scrollHeight`);
        await page.eval("t.append(500)");
        await page.waitFor(
            `document.querySelector('${OUTPUT}').scrollHeight > ${height}`,
            "the new lines to arrive",
        );
        await page.frames();
        const after = await view("line 2499");
        expect(after.top).toBe(before.top);
        expect(after.shows).toBe(false);
        expect(after.atBottom).toBe(false);
        expect(after.mounted).toBeLessThan(200);
    });

});

// Inventory: PaperConsole — Typing a command leaves nothing behind.
describe("PaperConsole's command line", () => {
    test("typing and sending a command makes no computation outside a root", async () => {
        page = await browser.open("console", { query: "input" });
        await page.click('[class*="_inputForm_"] input');
        await page.type("say hi");
        await page.press("Enter");
        await page.waitFor("t.commands.length === 1", "the command to be sent");
        expect(await page.eval("t.commands")).toEqual(["say hi"]);
        expect(page.warnings.filter((w) => w.includes("createRoot"))).toEqual([]);
    });
});
