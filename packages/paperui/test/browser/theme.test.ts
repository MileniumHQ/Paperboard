// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const theme = () => page.eval<string>(`document.querySelector(".paperui-root").getAttribute("data-paperui-theme")`);
const themeBecomes = (value: string) =>
    page.waitFor(`document.querySelector(".paperui-root").getAttribute("data-paperui-theme") === "${value}"`, `the ${value} theme`);
/** switches the system scheme and waits until the page's media listeners have heard it */
async function systemScheme(value: "light" | "dark") {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
    await page.frames();
}
// the shell writes the window's resolved theme on the panel document's root
const hostTheme = (value: string) => `document.documentElement.setAttribute("data-paperui-theme", "${value}")`;
// the same, before any page script runs: the root element doesn't exist yet when this starts
const hostThemeAtLoad = (value: string) => `new MutationObserver((_, observer) => {
    if (!document.documentElement) return;
    observer.disconnect();
    ${hostTheme(value)};
}).observe(document, { childList: true });`;

// Inventory: Layout and navigation — Theme and token helpers (PaperProvider's theme choice).
describe("PaperProvider theme", () => {
    test("the theme prop wins over the host's attribute and the system scheme", async () => {
        page = await browser.open("provider", { query: "theme=light", beforeLoad: hostThemeAtLoad("dark"), colorScheme: "dark" });
        expect(await theme()).toBe("light");

        await page.eval('t.setTheme("dark")');
        expect(await theme()).toBe("dark");
    });

    test("without a prop, the host's data-paperui-theme wins over the system scheme, and changes are followed", async () => {
        page = await browser.open("provider", { beforeLoad: hostThemeAtLoad("dark"), colorScheme: "light" });
        expect(await theme()).toBe("dark");

        await page.eval(hostTheme("light"));
        await themeBecomes("light");
        await systemScheme("dark");
        expect(await theme()).toBe("light");
    });

    test("without a prop or a host theme, it follows prefers-color-scheme live", async () => {
        page = await browser.open("provider", { colorScheme: "light" });
        expect(await theme()).toBe("light");
        await systemScheme("dark");
        await themeBecomes("dark");
        await systemScheme("light");
        await themeBecomes("light");
    });
});
