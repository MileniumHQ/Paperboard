// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const REGION = '[role="region"][aria-label="Notifications"]';
/** the toasts saying a failure, as their title and message (the icon and the close button aside) */
const alerts = () => page.eval<string[][]>(`[...document.querySelectorAll('${REGION} [role="alert"]')].map((el) => [...el.children[1].children].map((line) => line.textContent))`);
/** throws from a task of its own, as an event handler's failure does: nothing catches it */
const throwUncaught = (message: string) => page.eval(`setTimeout(() => { throw new Error(${JSON.stringify(message)}); }); 0`);
/** the failures the page reported to the console, which the suite then stops expecting */
function consoleSaid(): string[] {
    const said = [...page.errors];
    page.errors.length = 0;
    return said;
}

// Inventory: Feedback — nothing fails unseen: PaperProvider says what nothing caught.
describe("PaperProvider's uncaught errors", () => {
    test("a throw nothing caught is a toast, and the console still has it", async () => {
        page = await browser.open("uncaught");
        await throwUncaught("the button's handler failed");
        await page.waitFor(`document.querySelector('${REGION} [role="alert"]')`, "the failure's toast");
        expect(await alerts()).toEqual([["Something went wrong", "the button's handler failed"]]);
        expect(consoleSaid().join("\n")).toContain("the button's handler failed");
    });

    test("a rejected promise nobody awaited is a toast", async () => {
        page = await browser.open("uncaught");
        await page.eval(`Promise.reject(new Error("the save was refused")); 0`);
        await page.waitFor(`document.querySelector('${REGION} [role="alert"]')`, "the rejection's toast");
        expect(await alerts()).toEqual([["Something went wrong", "the save was refused"]]);
        expect(consoleSaid().join("\n")).toContain("the save was refused");
    });

    test("a failure that repeats is one toast while it shows, and comes back once it's closed", async () => {
        page = await browser.open("uncaught");
        for (let i = 0; i < 20; i++) await throwUncaught("moved off the canvas");
        await throwUncaught("another failure");
        await page.waitFor(`document.querySelectorAll('${REGION} [role="alert"]').length === 2`, "both toasts");
        await page.frames();
        expect(await alerts()).toEqual([["Something went wrong", "moved off the canvas"], ["Something went wrong", "another failure"]]);

        await page.click(`${REGION} [role="alert"]:first-child button[aria-label="Close"]`);
        await page.waitFor(`document.querySelectorAll('${REGION} [role="alert"]').length === 1`, "the closed toast to go");
        expect(await alerts()).toEqual([["Something went wrong", "another failure"]]);

        await throwUncaught("moved off the canvas");
        await page.waitFor(`document.querySelectorAll('${REGION} [role="alert"]').length === 2`, "the failure to be said again");
        expect(consoleSaid().filter((line) => line.includes("moved off the canvas"))).toHaveLength(21);
    });

    test("the browser's own notes, which carry no error, are not shown", async () => {
        page = await browser.open("uncaught");
        // a ResizeObserver that grows what it watches runs over: Chrome reports it as an error event with no error
        await page.eval(`(() => {
            t.notes = [];
            window.addEventListener("error", (event) => { if (!event.error) t.notes.push(event.message); });
            const box = document.getElementById("page");
            new ResizeObserver(() => { box.style.width = box.offsetWidth + 1 + "px"; }).observe(box);
            return 0;
        })()`);
        await page.waitFor("t.notes.length > 0", "the ResizeObserver's note");
        expect(await page.eval("t.notes[0]")).toContain("ResizeObserver loop");
        await throwUncaught("a real failure");
        await page.waitFor(`document.querySelector('${REGION} [role="alert"]')`, "the real failure's toast");
        expect(await alerts()).toEqual([["Something went wrong", "a real failure"]]);
        consoleSaid();
    });
});
