// The real Agents panel (Main) on real PaperUI, over the fake service in
// agentsApi.ts, driven through what a person does in its menu: settings
// while the brains can't be looked for. Results
// are base64 JSON in #results so the test can read them from Chrome's
// --dump-dom output.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Main from "../../src/Main";
import { UI_ACTION_IDS } from "../../src/contract";
import { service } from "./agentsApi";

const out = { checks: {} as Record<string, unknown>, error: "" };
const uncaught: string[] = [];
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

service.refuse[UI_ACTION_IDS.detect] = "harness detection is down";

const root = document.getElementById("app")!;
render(() => <PaperProvider fullWidth fullHeight><Main /></PaperProvider>, root);

const alertSaying = (within: ParentNode | undefined, text: string) =>
    Boolean(within && [...within.querySelectorAll('[role="alert"]')].some((a) => a.textContent?.includes(text)));
const page = async (value: string) => {
    const item = document.querySelector<HTMLInputElement>(`input[name="ai-pages"][value="${value}"]`);
    if (!item) throw new Error(`no ${value} page in the menu`);
    item.click();
    await sleep(300);
};

async function run() {
    const c = out.checks;
    await sleep(300);
    const menu = document.querySelector<HTMLButtonElement>('button[aria-label="Menu"]');
    if (!menu) throw new Error("the chat never showed");
    menu.click();
    await sleep(300);

    // settings while the brains can't be looked for: the page stands, and says why
    await page("settings");
    c.settingsShown = Boolean(document.querySelector('input[name="name"]'));
    c.detectFailureShown = alertSaying(document, "harness detection is down");

    c.uncaught = uncaught;
}

run()
    .catch((e) => {
        out.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    })
    .finally(() => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify(out))))}`;
    });
