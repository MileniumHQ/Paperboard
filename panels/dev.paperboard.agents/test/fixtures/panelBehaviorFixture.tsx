// The real Agents panel (Main) on real PaperUI, over the fake service in
// agentsApi.ts, driven through what a person does in its menu: settings
// while the brains can't be looked for, erasing the computer and removing a
// tool server when the service refuses, and reading the routines. Results
// are base64 JSON in #results so the test can read them from Chrome's
// --dump-dom output.
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

const HOUR = 60 * 60 * 1000;
service.routines = [{ id: "r1", what: "Text a flag fact", schedule: { kind: "every", minutes: 60 }, created: 0, lastRun: null, lastError: null, next: Date.now() + HOUR }];
service.refuse[UI_ACTION_IDS.detect] = "harness detection is down";

const root = document.getElementById("app")!;
render(() => <PaperProvider fullWidth fullHeight><Main /></PaperProvider>, root);

const openDialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
const dialogTitled = (title: string) => openDialogs().find((d) => d.textContent?.includes(title));
const button = (within: ParentNode, text: string) =>
    [...within.querySelectorAll("button")].find((b) => b.textContent?.trim().endsWith(text) && !b.disabled);
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

    // erasing the computer, refused: the confirmation says why
    const erase = button(document, "Set up again");
    if (!erase) throw new Error("no way to set the computer up again");
    erase.click();
    await sleep(300);
    const confirmErase = dialogTitled("Erase Pip's computer?");
    if (!confirmErase) throw new Error("erasing asked for no confirmation");
    service.refuse[UI_ACTION_IDS.installComputer] = "the disk is full";
    button(confirmErase, "Erase and set up")!.click();
    await sleep(300);
    c.eraseStillAsking = Boolean(dialogTitled("Erase Pip's computer?"));
    c.eraseRefusalInModal = alertSaying(dialogTitled("Erase Pip's computer?"), "the disk is full");
    button(confirmErase, "Keep it")?.click();
    await sleep(300);

    // removing a tool server, refused: the confirmation says why
    await page("tools");
    const remove = button(document, "Remove");
    if (!remove) throw new Error("no way to remove a tool server");
    remove.click();
    await sleep(300);
    const confirmRemove = dialogTitled("Remove notes?");
    if (!confirmRemove) throw new Error("removing asked for no confirmation");
    service.refuse[TOOLS_ACTION_IDS.remove] = "the vault is locked";
    button(confirmRemove, "Remove")!.click();
    await sleep(300);
    c.removeStillAsking = Boolean(dialogTitled("Remove notes?"));
    c.removeRefusalInModal = alertSaying(dialogTitled("Remove notes?"), "the vault is locked");
    button(confirmRemove, "Keep it")?.click();
    await sleep(300);

    // a routine's schedule reads quieter than what it does
    await page("routines");
    const what = [...document.querySelectorAll<HTMLElement>("*")].find((el) => el.children.length === 0 && el.textContent === "Text a flag fact");
    const when = [...document.querySelectorAll<HTMLElement>("*")].find((el) => el.children.length === 0 && el.textContent?.startsWith("every"));
    const muted = document.createElement("span");
    muted.style.color = "var(--paper-text-muted)";
    root.appendChild(muted);
    c.routineScheduleColor = when ? getComputedStyle(when).color : null;
    c.routineTextColor = what ? getComputedStyle(what).color : null;
    c.mutedColor = getComputedStyle(muted).color;
    muted.remove();

    c.uncaught = uncaught;
}

run()
    .catch((e) => {
        out.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    })
    .finally(() => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify(out))))}`;
    });
