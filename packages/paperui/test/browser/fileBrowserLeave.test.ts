// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const PHONE = { width: 390, height: 844, touch: true };
const EDITOR = `document.querySelector("textarea")`;
const QUESTION = `[...document.querySelectorAll('[role="dialog"]')].find((d) => d.innerText.includes("Save changes to a.txt?"))`;
const EDITED = "alpha\nbeta\n";

/** opens a.txt and types a line into it, without saving */
async function editA(options = {}) {
    page = await browser.open("fileBrowser", options);
    await page.waitFor(`document.querySelector('[role="treeitem"][data-path="a.txt"]')`, "the tree");
    await page.click('[role="treeitem"][data-path="a.txt"]');
    await page.waitFor(`${EDITOR}?.value === "alpha\\n"`, "a.txt in the editor");
    await page.eval(`(() => { const el = ${EDITOR}; el.focus(); el.setSelectionRange(el.value.length, el.value.length); })()`);
    await page.type("beta\n");
    await page.waitFor("t.dirty()", "the edit to count as unsaved");
}

/** presses the question's button named `name` */
async function answer(name: "Save" | "Discard" | "Cancel") {
    await page.waitFor(QUESTION, "the question about the unsaved edit");
    await page.eval(`[...${QUESTION}.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith(${JSON.stringify(name)})).id = "answer"`);
    // pressed where it rests: on a busy machine the question can still be
    // sliding in when its button is measured. What moves the button is an
    // animation on a box around it; the button's own hover fade doesn't.
    await page.waitFor(
        `(() => {
            const button = document.getElementById("answer");
            return document.getAnimations().every((a) => {
                const target = a.effect?.target;
                const moves = target !== button && target?.contains(button);
                return !moves || a.playState !== "running" || !Number.isFinite(a.effect.getComputedTiming().endTime);
            });
        })()`,
        "the question to come to rest",
    );
    await page.click("#answer");
    await page.eval(`document.getElementById("answer")?.removeAttribute("id")`);
    await page.waitFor(`!${QUESTION}`, "the question to close");
}

/** the leave the host asked for has been answered */
const answered = () => page.waitFor("t.answers.length > 0", "the browser's answer").then(() => page.eval<boolean[]>("t.answers"));

// Inventory: Templates — PaperFileBrowser guards leaving with unsaved edits.
describe("PaperFileBrowser confirmLeave", () => {
    test("with nothing unsaved it answers at once, without asking", async () => {
        page = await browser.open("fileBrowser");
        await page.eval("t.leave()");
        expect(await answered()).toEqual([true]);
        expect(await page.eval(`Boolean(${QUESTION})`)).toBe(false);
    });

    test("Cancel answers false and keeps the edit", async () => {
        await editA();
        await page.eval("void t.leave()");
        await answer("Cancel");
        expect(await answered()).toEqual([false]);
        expect(await page.eval(`${EDITOR}.value`)).toBe(EDITED);
        expect(await page.eval("t.dirty()")).toBe(true);
        expect(await page.eval("t.writes")).toBe(0);
    });

    test("Discard answers true with the edit thrown away", async () => {
        await editA();
        await page.eval("void t.leave()");
        await answer("Discard");
        expect(await answered()).toEqual([true]);
        expect(await page.eval("t.dirty()")).toBe(false);
        expect(await page.eval(`t.disk["a.txt"]`)).toBe("alpha\n");
    });

    test("Save answers true once the file holds the edit", async () => {
        await editA();
        await page.eval("void t.leave()");
        await answer("Save");
        expect(await answered()).toEqual([true]);
        expect(await page.eval(`t.disk["a.txt"]`)).toBe(EDITED);
        expect(await page.eval("t.dirty()")).toBe(false);
    });

    test("a Save that fails answers false and shows why", async () => {
        await editA();
        await page.eval(`t.changeOnDisk("gamma\\n")`);
        await page.eval("void t.leave()");
        await answer("Save");
        expect(await answered()).toEqual([false]);
        await page.waitFor(`[...document.querySelectorAll('[role="alert"]')].some((el) => el.innerText.includes("changed on disk"))`, "the save's error");
        expect(await page.eval(`${EDITOR}.value`)).toBe(EDITED);
        expect(await page.eval("t.dirty()")).toBe(true);
    });

    test("asked again while it asks, the earlier question answers false", async () => {
        await editA();
        await page.eval("void t.leave()");
        await page.waitFor(QUESTION, "the first question");
        await page.eval("void t.leave()");
        expect(await answered()).toEqual([false]);
        await answer("Discard");
        await page.waitFor("t.answers.length === 2", "the second answer");
        expect(await page.eval("t.answers")).toEqual([false, true]);
    });
});

describe("PaperFileBrowser on a phone", () => {
    const FILE_PAGE = `[...document.querySelectorAll('[role="region"]')].find((r) => r.getAttribute("aria-label") === "a.txt")`;
    const inPlace = () => page.waitFor(`Math.abs(${FILE_PAGE}.getBoundingClientRect().left) < 1`, "the file's page in place");

    test("the file page's Back asks before it slides, and Cancel keeps the page and the edit", async () => {
        await editA(PHONE);
        await inPlace();
        await page.eval(`${FILE_PAGE}.querySelector(':scope > header button[aria-label="Back"]').id = "file-back"`);
        await page.tap("#file-back");
        await answer("Cancel");
        await inPlace();
        expect(await page.eval(`${FILE_PAGE}.inert`)).toBe(false);
        expect(await page.eval(`${EDITOR}.value`)).toBe(EDITED);

        // a back swipe from the page's edge asks the same
        await page.touchDrag([
            { x: 4, y: 400 },
            { x: 60, y: 402 },
            { x: 160, y: 404 },
            { x: 300, y: 406 },
        ]);
        // the swipe lifted off where it started, so pressCancel takes the next
        // click as the swipe's own: a tap on the question's text gives it one
        await page.waitFor(QUESTION, "the question after the swipe");
        await page.eval(`[...${QUESTION}.querySelectorAll("span")].find((el) => el.textContent === "Your changes will be lost if you don't save them.").id = "question-text"`);
        await page.tap("#question-text");
        await answer("Discard");
        await page.waitFor(`!${FILE_PAGE} || ${FILE_PAGE}.inert`, "the file's page to close");
        await page.waitFor(`!${EDITOR}`, "the file to close");
        expect(await page.eval("t.dirty()")).toBe(false);
    });
});
