// The real Agent panel (Main) on real PaperUI, over the fake service in
// agentsApi.ts, switching between the pages of its menu as a person does,
// with the service taking a moment to answer each page's first read. Every
// rendered frame is read: a switch must never paint an empty page or a
// loader in between, the page waits only a moment for a slow read, and the
// Computer page sits on the same surface as every other page.
// Results are base64 JSON in #results.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Main from "../../src/Main";
import { UI_ACTION_IDS } from "../../src/contract";
import { TOOLS_ACTION_IDS } from "../../src/toolsContract";
import { service } from "./agentsApi";

const out = { checks: {} as Record<string, unknown>, error: "" };
const uncaught: string[] = [];
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// about as long as the service takes to read a page's data off the disk
service.slow[UI_ACTION_IDS.memory] = 60;
service.slow[UI_ACTION_IDS.routines] = 60;
service.slow[TOOLS_ACTION_IDS.get] = 60;

render(() => <PaperProvider fullWidth fullHeight><Main /></PaperProvider>, document.getElementById("app")!);

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const menuItem = (value: string) => {
    const item = document.querySelector<HTMLInputElement>(`input[name="ai-pages"][value="${value}"]`);
    if (!item) throw new Error(`no ${value} page in the menu`);
    return item;
};
// the column the pages show in: beside the menu, the last in the workspace's layout
const pageColumn = () => {
    const column = dialog()?.querySelector('[class*="_layout_"]')?.lastElementChild;
    if (!(column instanceof HTMLElement)) throw new Error("no page column beside the menu");
    return column;
};
// what the page column paints: its text, a loader's label included (even while it fades in)
const painted = () => pageColumn().innerText.trim();
const LOADING = /(^|\n)Reading /;

// switch to a page and read every frame until it has settled
async function switchTo(value: string, settledText: RegExp, frames = 40) {
    menuItem(value).click();
    const seen: string[] = [];
    for (let i = 0; i < frames; i++) {
        await frame();
        seen.push(painted());
    }
    return {
        blank: seen.filter((s) => s === "").length,
        loader: seen.filter((s) => LOADING.test(s)).length,
        settled: settledText.test(painted()),
    };
}

// the first surface behind the middle of the page column
function surfaceBehind(): string {
    const r = pageColumn().getBoundingClientRect();
    for (let el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height - 4); el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return "none";
}

async function run() {
    const c = out.checks;
    for (let i = 0; i < 50 && !document.querySelector('button[aria-label="Menu"]'); i++) await sleep(100);
    const menu = document.querySelector<HTMLButtonElement>('button[aria-label="Menu"]');
    if (!menu) throw new Error("the chat never showed");
    menu.click();
    await sleep(600);
    if (!dialog()) throw new Error("the menu never opened");

    c.computerSurface = surfaceBehind();
    c.memories = await switchTo("memories", /Nothing yet/);
    c.memoriesSurface = surfaceBehind();
    c.routines = await switchTo("routines", /No routines yet/);
    c.tools = await switchTo("tools", /Paperboard actions/);
    c.settings = await switchTo("settings", /Name/);
    c.backToMemories = await switchTo("memories", /Nothing yet/);

    // a read that takes long: the page shows with its loader after a moment, never stuck on the last page
    service.slow[UI_ACTION_IDS.routines] = 3000;
    menuItem("routines").click();
    await sleep(600);
    c.slowShowsLoader = LOADING.test(painted());
    const titleId = dialog()?.getAttribute("aria-labelledby");
    c.slowTitle = titleId ? (document.getElementById(titleId)?.textContent ?? null) : null;

    c.uncaught = uncaught;
}

run()
    .catch((e) => {
        out.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    })
    .finally(() => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify(out))))}`;
    });
