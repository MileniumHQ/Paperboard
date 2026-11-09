// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const ROOT_MENU = '[role="menu"][data-context-root]:not([data-context-parent])';
const SUBMENU = '[role="menu"][data-context-parent]';
const item = (label: string) => `[data-context-item="${label}"]`;
const menuOpen = () => page.eval<boolean>(`document.querySelector('${ROOT_MENU}') !== null`);
const highlighted = () => page.eval<string | null>(`document.querySelector('${ROOT_MENU}').getAttribute("aria-activedescendant")`);

/** waits until a press at the element's center lands on it: placed, painted, on top */
const hittable = (selector: string, what: string) =>
    page.waitFor(
        `(() => { const el = document.querySelector('${selector}'); if (!el) return false; const r = el.getBoundingClientRect();
            return r.width > 0 && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`,
        what,
    );

async function openMenu() {
    page = await browser.open("contextMenu");
    await page.click("#target", "right");
    await hittable(item("Rename"), "the context menu to open");
}

// Inventory: Menus and form controls — Context menu contract.
describe("PaperContextMenu", () => {
    test("pressing an item runs it, then closes the menu", async () => {
        await openMenu();
        await page.click(item("Rename"));
        expect(await page.eval("t.runs")).toEqual(["Rename"]);
        expect(await page.eval("t.closes")).toBe(1);
        expect(await menuOpen()).toBe(false);
    });

    test("an open menu closes on Escape", async () => {
        await openMenu();
        await page.press("Escape");
        expect(await page.eval("t.closes")).toBe(1);
        expect(await menuOpen()).toBe(false);
    });

    test("an open menu closes when something scrolls", async () => {
        await openMenu();
        await page.eval('document.getElementById("scroller").scrollTop = 200');
        await page.waitFor("t.closes === 1", "the scroll to close the menu");
        expect(await menuOpen()).toBe(false);
        expect(await page.eval("t.runs")).toEqual([]);
    });

    test("an open menu closes on the pointer-down of an outside press", async () => {
        await openMenu();
        const outside = { x: 900, y: 600 };
        await page.mouse("mouseMoved", outside);
        await page.mouse("mousePressed", outside);
        expect(await page.eval("t.closes")).toBe(1);
        expect(await menuOpen()).toBe(false);
        await page.mouse("mouseReleased", outside);
        expect(await page.eval("t.closes")).toBe(1);
    });

    test("ArrowRight opens a submenu, and Enter runs its item and closes the whole menu once", async () => {
        await openMenu();
        await page.press("ArrowDown");
        await page.press("ArrowDown");
        const sub = await page.eval<string>(`document.querySelector('${ROOT_MENU} [data-context-sub]').getAttribute("data-context-sub")`);
        expect(await highlighted()).toBe(`paper-menuitem-${sub}`);

        await page.press("ArrowRight");
        await page.waitFor(`document.querySelector('${SUBMENU}') !== null`, "the submenu to open");
        expect(await highlighted()).toBe("paper-menuitem-Folder A");

        await page.press("ArrowDown");
        expect(await highlighted()).toBe("paper-menuitem-Folder B");
        await page.press("Enter");
        expect(await page.eval("t.runs")).toEqual(["Folder B"]);
        expect(await page.eval("t.closes")).toBe(1);
        expect(await menuOpen()).toBe(false);
        expect(await page.eval(`document.querySelector('${SUBMENU}') === null`)).toBe(true);
    });

    test("Enter on a submenu row opens it, and Escape climbs back out", async () => {
        await openMenu();
        await page.press("ArrowDown");
        await page.press("ArrowDown");
        await page.press("Enter");
        await page.waitFor(`document.querySelector('${SUBMENU}') !== null`, "Enter to open the submenu");
        expect(await page.eval("t.runs")).toEqual([]);

        await page.press("Escape");
        expect(await page.eval(`document.querySelector('${SUBMENU}') === null`)).toBe(true);
        expect(await menuOpen()).toBe(true);
        expect(await page.eval("t.closes")).toBe(0);
    });

    test("pressing inside a portaled submenu doesn't dismiss it, and its item runs once", async () => {
        await openMenu();
        await page.mouse("mouseMoved", await page.center(`${ROOT_MENU} [data-context-sub]`));
        await hittable(`${SUBMENU} [data-context-item="Folder A"]`, "the submenu to open on hover");
        // the submenu is portaled out of the root menu, not inside it
        expect(await page.eval(`document.querySelector('${ROOT_MENU}').contains(document.querySelector('${SUBMENU}'))`)).toBe(false);

        const header = await page.center(`${SUBMENU} > :first-child`);
        // the press lands in the submenu panel, on no item
        expect(
            await page.eval(`(() => { const hit = document.elementFromPoint(${header.x}, ${header.y});
                return document.querySelector('${SUBMENU}').contains(hit) && !hit.closest("[data-context-item]"); })()`),
        ).toBe(true);
        await page.clickAt(header);
        expect(await menuOpen()).toBe(true);
        expect(await page.eval(`document.querySelector('${SUBMENU}') !== null`)).toBe(true);
        expect(await page.eval("t.closes")).toBe(0);

        await page.click(`${SUBMENU} ${item("Folder A")}`);
        expect(await page.eval("t.runs")).toEqual(["Folder A"]);
        expect(await page.eval("t.closes")).toBe(1);
        expect(await menuOpen()).toBe(false);
    });
});
