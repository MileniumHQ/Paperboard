// The real Agents panel (Main) on real PaperUI, over the fake service in
// agentsApi.ts, driven through what a person does in its menu: settings
// while the brains can't be looked for, erasing the computer and removing a
// tool server when the service refuses, and reading the routines.
// The chat opens on a turn that failed, which must say what didn't happen,
// and on an app's card, which opens the app beside the chat, and the Apps
// page lists the app and deletes it after asking.
// Results are base64 JSON in #results so the test can read them from Chrome's
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
// Claude is installed but its look at itself failed; OpenCode isn't installed, and installing it is refused
service.state.brains["codex"] = { ...service.state.brains["codex"], phase: "ready", installed: true, signedIn: true, account: "Logged in using ChatGPT", version: "0.166.0" };
service.state.brains["claude-code"] = { ...service.state.brains["claude-code"], phase: "failed", installed: true, error: "Claude's sign-in status couldn't be read: database is locked" };
service.refuse[UI_ACTION_IDS.installBrain] = "the download was refused";
service.history = [
    { id: "m1", at: Date.now() - 1000, kind: "user", text: "hi" },
    { id: "m2", at: Date.now(), kind: "error", title: "Not answered", text: "usage limit reached" },
    { id: "m3", at: Date.now(), kind: "app", app: "planner", title: "Assignment planner", description: "What's due, by class." },
];
service.apps = [
    { name: "planner", title: "Assignment planner", description: "What's due, by class.", picture: true },
    { name: "clock", title: "Clock", description: "The time, big.", picture: false },
];

const root = document.getElementById("app")!;
render(() => <PaperProvider fullWidth fullHeight><Main /></PaperProvider>, root);

const openDialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
const dialogTitled = (title: string) => openDialogs().find((d) => d.textContent?.includes(title));
const button = (within: ParentNode, text: string) =>
    [...within.querySelectorAll("button")].find((b) => b.textContent?.trim().endsWith(text) && !b.disabled);
// Open is a word and an icon
const openIn = (within: ParentNode) => [...within.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Open"))!;
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
    // a failed turn in the conversation names what didn't happen, beside why
    const failed = [...document.querySelectorAll('[role="alert"]')].find((a) => a.textContent?.includes("usage limit reached"));
    c.chatFailureTitled = Boolean(failed?.textContent?.includes("Not answered"));

    // an app's card: its picture, name and what it's for, and Open; never a link
    const card = document.querySelector<HTMLElement>('section[aria-label="Assignment planner"]');
    c.cardShown = Boolean(card?.textContent?.includes("What's due, by class.") && card.querySelector("img"));
    c.cardLinks = card ? card.querySelectorAll("a").length : -1;
    const frame = () => document.querySelector<HTMLIFrameElement>('iframe[title="Assignment planner"]');
    const chatInert = () => Boolean(menu.closest("[inert]"));
    c.frameBeforeOpen = Boolean(frame());
    openIn(card!).click();
    await sleep(400);
    c.frameOpened = frame()?.getAttribute("src") ?? null;
    // the address never shows
    c.addressShown = document.body.innerText.includes("about:blank");
    c.chatBesideApp = !chatInert();
    // extend: the chat leaves; again: it comes back
    document.querySelector<HTMLButtonElement>('button[aria-label="Hide the chat"]')!.click();
    await sleep(400);
    c.chatGoneWhenExtended = chatInert();
    document.querySelector<HTMLButtonElement>('button[aria-label="Show the chat"]')!.click();
    await sleep(400);
    c.chatBackFromExtended = !chatInert();
    // close: the app slides away and goes
    const bar = frame()!.previousElementSibling!;
    [...bar.querySelectorAll<HTMLButtonElement>('button[aria-label="Close"]')][0]!.click();
    await sleep(500);
    c.frameAfterClose = Boolean(frame());
    c.chatFullAfterClose = !chatInert();

    // the conversations: the current one is listed, and marked
    document.querySelector<HTMLButtonElement>('button[aria-label="Past conversations"]')!.click();
    await sleep(300);
    const marked = () => [...document.querySelectorAll<HTMLInputElement>('input[name="agents-history"]')].filter((i) => i.checked).map((i) => i.value);
    c.conversationsListed = [...document.querySelectorAll<HTMLInputElement>('input[name="agents-history"]')].map((i) => i.value);
    c.currentMarked = marked();
    // choosing it again just goes back to it
    document.querySelector<HTMLInputElement>('input[name="agents-history"][value="current"]')!.closest("label")!.click();
    await sleep(300);
    c.historyClosedOnCurrent = !dialogTitled("Conversations");

    // a message: its text can be selected, and a right click offers Reply and Copy
    const said = document.querySelector<HTMLElement>('[data-message="m1"] [data-selectable="true"]')!;
    c.bubbleSelectable = getComputedStyle(said).userSelect;
    said.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await sleep(300);
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    c.bubbleMenu = items().map((i) => i.textContent?.replace(/^\w+(?=[A-Z])/, "").trim());
    items().find((i) => i.textContent?.endsWith("Reply"))!.click();
    await sleep(300);
    c.replyFromMenu = document.body.innerText.includes("Replying to");

    menu.click();
    await sleep(300);

    // the Apps page: each app, opened or deleted from the list
    await page("apps");
    const appsList = () => [...document.querySelectorAll<HTMLInputElement>('input[name="agents-apps"]')].map((i) => i.value);
    c.appsListed = appsList();
    c.appsMarked = [...document.querySelectorAll<HTMLInputElement>('input[name="agents-apps"]')].filter((i) => i.checked).map((i) => i.value);
    const deleteClock = document.querySelector<HTMLButtonElement>('button[aria-label="Delete “Clock”"]');
    if (!deleteClock) throw new Error("no way to delete an app");
    deleteClock.click();
    await sleep(300);
    const confirmDelete = dialogTitled("Delete this app?");
    c.deleteAsked = Boolean(confirmDelete?.textContent?.includes("~/Apps/clock"));
    button(confirmDelete!, "Delete")!.click();
    await sleep(300);
    c.deleteCalled = service.calls.includes(UI_ACTION_IDS.deleteApp);
    c.appsAfterDelete = appsList();
    // opening one from the list closes the menu and shows it beside the chat
    const fromList = [...document.querySelectorAll<HTMLElement>("label")].find((l) => l.querySelector('input[name="agents-apps"][value="planner"]'));
    openIn(fromList!).click();
    await sleep(400);
    c.menuClosedOnOpen = !dialogTitled("Apps");
    c.frameFromList = frame()?.getAttribute("src") ?? null;
    // back in the list, the open one is marked
    menu.click();
    await sleep(300);
    await page("apps");
    c.openAppMarked = [...document.querySelectorAll<HTMLInputElement>('input[name="agents-apps"]')].filter((i) => i.checked).map((i) => i.value);
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.click();
    await sleep(300);
    [...frame()!.previousElementSibling!.querySelectorAll<HTMLButtonElement>('button[aria-label="Close"]')][0]!.click();
    await sleep(500);

    menu.click();
    await sleep(300);

    // settings while a brain is in trouble: the page stands, and says why
    await page("settings");
    c.settingsShown = Boolean(document.querySelector('input[name="name"]'));
    c.brainFailureShown = alertSaying(document, "database is locked");
    // installing one, refused: the page names the brain that didn't install and says why
    const install = button(document, "Install");
    if (!install) throw new Error("a brain that isn't installed offers no way to install it");
    install.click();
    await sleep(300);
    c.installRefusalShown = alertSaying(document, "the download was refused");

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
