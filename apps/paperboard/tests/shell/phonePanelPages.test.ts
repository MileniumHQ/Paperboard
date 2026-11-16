// A panel's own pages on a phone (bootShell({ phone: true })): the shell's
// bar names them after the panel, the pages draw no bar of their own, and
// the shell's Back goes back through them before it leaves the panel.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as path from "node:path";
import { bootShell, type DevPanel, type Shell } from "./support/shell";

// a list whose row opens "My Server › Overview", named as PaperUI's pages name themselves
const PAGES: DevPanel = {
    source: path.join(import.meta.dir, "support/pages-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};

let shell: Shell;
let key: string;

beforeAll(async () => {
    shell = await bootShell({ phone: true });
    const { id } = await shell.pairComputer("Shed", [PAGES]);
    key = `${id}::dev.paperboard.testpages`;
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Panels — on a phone, one bar names the panel and its open pages, and its Back steps out of them first.
test("on a phone, the shell's one bar names a panel's open pages, and Back steps out of them before leaving the panel", async () => {
    const { page } = shell;
    const frame = `document.querySelector("iframe[data-panel-key='${key}']")`;
    const doc = `${frame}?.contentDocument`;
    // what the shell's bar names: the panel, then its pages
    const bar = `document.querySelector("[role=region][aria-label^='Pages']")?.getAttribute("aria-label")`;
    const shown = `${doc}?.getElementById("shown")?.textContent`;

    // pressed as the page's own clicks: the phone takes touches, which page.click doesn't send
    await page.evaluate(`document.querySelector("[role=radio][aria-label='Shed (127.0.0.2)']").click()`);
    await page.waitFor(`document.querySelector("label[data-value='dev.paperboard.testpages']")`, "Pages in Shed's list");
    await page.evaluate(`document.querySelector("label[data-value='dev.paperboard.testpages']").click()`);
    await page.waitFor(`${shown} === "The list"`, "the panel's page");
    // the shell draws the bar, so the panel's pages draw none
    await page.waitFor(`${doc}.documentElement.hasAttribute("data-paper-host-bars")`, "the panel told the shell draws its bars");
    expect(await page.evaluate(bar)).toBe("Pages");

    await page.evaluate(`${doc}.getElementById("server").click()`);
    await page.waitFor(`${bar} === "Pages, My Server, Overview"`, "the bar naming the panel's pages");

    // Back closes the innermost page, then the next, then leaves the panel
    const back = () => page.evaluate(`document.querySelector("[role=region][aria-label^='Pages'] header button[aria-label='Back']").click()`);
    await back();
    await page.waitFor(`${shown} === "My Server" && ${bar} === "Pages, My Server"`, "Overview closed");
    await back();
    await page.waitFor(`${shown} === "The list" && ${bar} === "Pages"`, "My Server closed");
    expect(await page.evaluate<boolean>(`document.querySelector("[role=region][aria-label^='Pages']").hasAttribute("inert")`)).toBe(false);
    await back();
    await page.waitFor(`document.querySelector("[role=region][aria-label^='Pages']").hasAttribute("inert")`, "the panel's page closed");
    expect(await page.evaluate(shown)).toBe("The list");
    expect(page.exceptions).toEqual([]);
});
