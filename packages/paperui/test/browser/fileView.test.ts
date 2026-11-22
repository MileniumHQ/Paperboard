// @vitest-environment node
import { describe, expect, test } from "vitest";
import { MODIFIERS, type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// every page here runs under the panel's CSP, as a panel's file view does
const open = (extra = "") => browser.open("fileView", { query: `csp=panel${extra ? `&${extra}` : ""}` });
const at = (path: string) => `[data-path="${path}"]`;
const shown = () => page.eval<string[]>(`[...document.querySelectorAll("[data-path]")].map((e) => e.dataset.path)`);
const chosen = () => page.eval<string[]>("t.selection()");
const ready = (path = "notes.md") => page.waitFor(`document.querySelector('${at(path)}')`, `${path} to be listed`);

// Inventory: Components — PaperFileView shows a folder as icons or a list, and owns choosing, keys, renaming and drops.
describe("PaperFileView", () => {
    test("folders come first, then files by name; a click chooses, and arrows and Shift walk the choice", async () => {
        page = await open();
        await ready();
        expect(await shown()).toEqual(["Archive", "Photos", "budget.csv", "notes.md", "trip.mp4"]);
        await page.click(at("budget.csv"));
        expect(await chosen()).toEqual(["budget.csv"]);
        await page.press("ArrowRight");
        expect(await chosen()).toEqual(["notes.md"]);
        await page.press("ArrowLeft", MODIFIERS.shift);
        await page.press("ArrowLeft", MODIFIERS.shift);
        expect(await chosen()).toEqual(["Photos", "budget.csv", "notes.md"]);
        await page.press("a", MODIFIERS.ctrl);
        expect((await chosen()).length).toBe(5);
        await page.press("Escape");
        expect(await chosen()).toEqual([]);
    });

    test("Enter opens a folder, Space looks at a file, and typing finds a name", async () => {
        page = await open();
        await ready();
        await page.click(at("notes.md"));
        await page.press(" ");
        expect(await page.eval("t.looked")).toEqual(["notes.md"]);
        await page.press("t");
        await page.press("r");
        expect(await chosen()).toEqual(["trip.mp4"]);
        await page.click(at("Photos"));
        await page.press("Enter");
        expect(await page.eval("t.opened")).toEqual(["Photos"]);
        await page.waitFor(`document.querySelector('${at("Photos/beach.png")}')`, "the folder's own files");
        expect(await shown()).toEqual(["Photos/beach.png", "Photos/dunes.png"]);
    });

    test("F2 renames in place, with the name chosen up to its extension; Escape leaves it", async () => {
        page = await open();
        await ready();
        await page.click(at("notes.md"));
        await page.press("F2");
        await page.waitFor(`document.activeElement?.getAttribute("aria-label") === "Name"`, "the name field");
        expect(await page.eval(`[document.activeElement.selectionStart, document.activeElement.selectionEnd]`)).toEqual([0, 5]);
        await page.type("journal");
        await page.press("Enter");
        expect(await page.eval("t.renamed")).toEqual(["notes.md -> journal.md"]);

        await page.press("F2");
        await page.waitFor(`document.activeElement?.getAttribute("aria-label") === "Name"`, "the name field again");
        await page.type("gone");
        await page.press("Escape");
        expect(await page.eval("t.renamed")).toEqual(["notes.md -> journal.md"]);
    });

    test("Delete hands the chosen entries to the host, and a right click asks for its menu", async () => {
        page = await open();
        await ready();
        await page.click(at("budget.csv"));
        await page.press("ArrowRight", MODIFIERS.shift);
        await page.press("Delete");
        expect(await page.eval("t.deleted")).toEqual([["budget.csv", "notes.md"]]);
        await page.click(at("trip.mp4"), "right");
        expect(await page.eval("t.menus")).toEqual(["trip.mp4"]);
        expect(await chosen()).toEqual(["trip.mp4"]);
    });

    test("an entry dragged onto a folder moves there, and files from the computer drop onto a folder or the view", async () => {
        page = await open();
        await ready();
        await page.eval(`t.dragOnto("notes.md", "Archive")`);
        await page.eval(`t.dropFile("Photos")`);
        await page.eval(`t.dropFile("")`);
        // a folder can't be dropped into itself
        await page.eval(`t.dragOnto("Archive", "Archive")`);
        expect(await page.eval("t.drops")).toEqual([
            { kind: "entries", paths: ["notes.md"], folder: "Archive" },
            { kind: "files", folder: "Photos", names: ["hello.txt"] },
            { kind: "files", folder: "", names: ["hello.txt"] },
        ]);
    });

    test("the list sorts by a column, folders still first", async () => {
        page = await open("mode=list");
        await ready();
        // the head's third column
        await page.click(`[role="row"] button:nth-of-type(3)`);
        await page.waitFor(`t.order()[2] === "trip.mp4"`, "the biggest file first");
        expect(await page.eval("t.order()")).toEqual(["Photos", "Archive", "trip.mp4", "budget.csv", "notes.md"]);
        expect(await page.eval(`document.querySelector("[aria-sort]").textContent`)).toContain("Size");
    });

    test("thumbnails are asked for only near the screen, and drawn in place of the symbol", async () => {
        page = await open("folder=Many");
        await ready("Many/photo 1.png");
        await page.waitFor(`document.querySelectorAll("[data-path] img").length > 0`, "the first pictures");
        const asked = await page.eval<number>("t.thumbnails.length");
        expect(asked).toBeGreaterThan(0);
        expect(asked).toBeLessThan(150);
    });

    test("an empty folder says so, and one that can't be listed says why with Try again", async () => {
        page = await open("folder=Archive");
        await page.waitFor(`document.body.innerText.includes("This folder is empty")`, "the empty state");

        page = await open("fail=1");
        await page.waitFor(`document.body.innerText.includes("Couldn't open this folder")`, "the failure");
        expect(await page.eval(`document.body.innerText`)).toContain("the disk is asleep");
        await page.eval("t.heal()");
        await page.click(`button:not([aria-label])`);
        await ready();
    });
});
