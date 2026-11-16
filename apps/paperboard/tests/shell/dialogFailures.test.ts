// What a dialog says when its action fails: a toast over the dialog, which stays
// open to try again; a name that is wrong under its field; and a panel
// permission question that can always be closed, however its answer fares.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, clickText, fieldOf, fieldShown, toastShown, type Shell } from "./support/shell";

let shell: Shell;
const rail = (label: string) => `[role=radio][aria-label=${JSON.stringify(label)}]`;
const PANEL = "dev.example.notes";
const ASK = { askId: "ask-1", computerId: "local", panelId: PANEL, permissions: ["microphone"] };
const QUESTION = `[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("use your microphone"))`;
const CLOSE_QUESTION = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("use your microphone"))?.querySelector("button[aria-label='Close modal']")`;

beforeAll(async () => {
    shell = await bootShell({ init: ELECTRON_PRELOAD });
});

afterAll(async () => {
    await shell?.close();
});

const escape = () => shell.page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);

// Inventory: Core contracts — a failure in a dialog is a toast over that dialog, which stays usable for another try.
test("a forget the computer list refuses is a toast over the dialog, which stays open and forgets on the next try", async () => {
    const { page } = shell;
    const workshop = await shell.pairComputer("Workshop");
    const WORKSHOP = rail("Workshop (127.0.0.2)");
    expect(workshop.id).toBeTruthy();
    await shell.host({ cmd: "fail-remove", message: "The computer list is read-only" });
    await page.click(WORKSHOP, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Forget Computer']")`, "Workshop's menu");
    await page.click("[data-context-item='Forget Computer']");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("forget Workshop")`, "the Forget Computer dialog");
    await clickText(page, "[role=dialog] button", "Forget Computer");

    await page.waitFor(toastShown("Couldn't forget this computer", "The computer list is read-only"), "the failure, as a toast");
    // over the dialog, where a press reaches it, and no red line of text beside the question
    expect(await page.evaluate(`(() => {
        const toast = document.querySelector("[aria-label=Notifications] [role=alert]");
        const box = toast.getBoundingClientRect();
        return toast.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })()`)).toBe(true);
    expect(await page.evaluate(`document.querySelector("[role=dialog]").innerText.includes("read-only")`)).toBe(false);
    expect(await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].every((b) => !b.disabled)`)).toBe(true);

    // the dialog is still there: the next press goes through
    await clickText(page, "[role=dialog] button", "Forget Computer");
    await page.waitFor(`!document.querySelector(${JSON.stringify(WORKSHOP)}) && !document.querySelector("[role=dialog]")`, "Workshop gone");
    await page.waitFor(`!${toastShown("Couldn't forget this computer")}`, "the failure toast gone with the success");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a field's failure is said under the field, which says so to a screen reader.
test("a computer name that is too long is said under its field, described to assistive technology, and cannot be saved", async () => {
    const { page } = shell;
    const LOCAL = rail("This Computer (127.0.0.1)");
    await page.click(LOCAL, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Change Name']")`, "the computer's menu");
    await page.click("[data-context-item='Change Name']");
    await page.waitFor(fieldShown("Name"), "the Change Name dialog");
    await page.type(fieldOf("Name"), "x".repeat(70));

    const words = "A computer name can be at most 64 characters.";
    await page.waitFor(`document.querySelector(${JSON.stringify(fieldOf("Name"))}).getAttribute("aria-invalid") === "true"`, "the field marked invalid");
    expect(await page.evaluate<string>(`(() => {
        const input = document.querySelector(${JSON.stringify(fieldOf("Name"))});
        return input.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent).join("|");
    })()`)).toContain(words);
    expect(await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.trim() === "Save").disabled`)).toBe(true);
    // no toast: it is the field's to say
    expect(await page.evaluate(`!!document.querySelector("[aria-label=Notifications] [role=alert]")`)).toBe(false);

    // a name that fits is fine again
    await page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(fieldOf("Name"))}); i.value = "Shed"; i.dispatchEvent(new InputEvent("input", { bubbles: true })); })()`);
    await page.waitFor(`document.querySelector(${JSON.stringify(fieldOf("Name"))}).getAttribute("aria-invalid") !== "true"`, "the field fine again");
    await clickText(page, "[role=dialog] button", "Cancel");
    await page.waitFor(`!document.querySelector("[role=dialog]")`, "the dialog closed");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a person can always close a panel's permission question, however its answer fares.
test("a permission question whose answer keeps failing says why in a toast, and still closes with Escape and its close button", async () => {
    const { page } = shell;
    // main's answer channel isn't here: the host refuses every answer, as a window main can't reach would
    await shell.host({ cmd: "push", channel: "panel-permission-ask", payload: ASK });
    await page.waitFor(QUESTION, "the question");
    await clickText(page, "[role=dialog] button", "Allow");
    await page.waitFor(toastShown("Your answer didn't go through"), "the failed answer, as a toast");
    expect(await page.evaluate(QUESTION)).toBe(true);
    // answering again fails the same way, and the question is still open
    await clickText(page, "[role=dialog] button", "Don't allow");
    await page.waitFor(`${QUESTION} && [...document.querySelectorAll("[role=dialog] button")].every((b) => !b.disabled)`, "still asking, with that answer settled");

    await escape();
    await page.waitFor(`!(${QUESTION})`, "the question closed with Escape");
    await page.waitFor(toastShown("Couldn't tell Paperboard you closed the question"), "a toast saying main wasn't told");

    await shell.host({ cmd: "push", channel: "panel-permission-ask", payload: { ...ASK, askId: "ask-2" } });
    await page.waitFor(QUESTION, "the question again");
    await page.waitFor(`!!(${CLOSE_QUESTION})`, "its close button");
    await page.evaluate(`(${CLOSE_QUESTION}).dataset.closeThis = ""`);
    await page.click("[data-close-this]");
    await page.waitFor(`!(${QUESTION})`, "the question closed with its close button");
    expect(page.exceptions).toEqual([]);
});
