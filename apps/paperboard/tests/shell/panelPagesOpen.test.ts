// A panel's service hears how many of its pages are open: the shell's frame
// says so when its page is ready, and stops counting when the page goes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, type DevPanel, type Shell } from "./support/shell";

// its service keeps every count it heard in its config
const PAGES: DevPanel = {
    source: path.join(import.meta.dir, "support/pages-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};
const ID = "dev.paperboard.testpages";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ panels: [PAGES] });
});

afterAll(async () => {
    await shell?.close();
});

const heard = (): number[] => {
    const file = path.join(shell.daemon.dataDir, "configs", `${ID}.json`);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")).heard ?? []) : [];
};
async function until(what: string, want: number[]): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (JSON.stringify(heard()) !== JSON.stringify(want)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: the service heard ${JSON.stringify(heard())}`);
        // quiet: the poll interval of a deadline-bound wait for the service's config
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// Inventory: Core contracts — a service hears its pages open and close.
test("opening a panel's page counts it for its service, and the page going takes it away", async () => {
    const { page } = shell;
    await until("the service to hear no page is open", [0]);
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("label[data-value='${ID}']")`, "Pages in the sidebar");
    await page.click(`label[data-value='${ID}']`);
    await page.waitFor(`document.querySelector("iframe[data-panel-key='local::${ID}']")?.contentDocument?.getElementById("shown")?.textContent === "The list"`, "the panel's page");
    await until("the page to count", [0, 1]);
    // the shell going takes its frames with it
    await page.navigate("about:blank");
    await until("the page to stop counting", [0, 1, 0]);
    expect(page.exceptions).toEqual([]);
});
