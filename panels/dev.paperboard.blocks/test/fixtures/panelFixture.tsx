// The whole panel in a real browser (App, as index.tsx mounts it) over the
// real service, on a real daemon (test/browserFixture.ts): every state it
// announces arrives as new objects. A person opens a project and uses it
// while the service keeps announcing: log lines arrive (the project's flow
// logs what the Fixture Panel gives it), the project list changes under an
// open dialog (another window makes a project), variables are made and
// renamed while the Library is scrolled. A call the service refuses is
// sent for a project it doesn't have (fixtures/wire.ts). What the page kept
// through each is posted back to the test as JSON. Keys and clicks that matter as a person's
// own (Enter, the click that leaves focus on a button) are sent through
// DevTools (/input), so Chrome handles them as trusted input.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import type { LogEntry } from "../../src/panel";
import { BUILTIN } from "../../src/lib/names";
import { NOT_SAVED } from "../../src/editorFlows";
import { serviceState } from "../../src/bridge";
import { ask, askLeave, calls, held, holdNextList, holdsUnsaved, refuse, release } from "./wire";
import { LATE_PANEL_NAME } from "./world";

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
// quiet: a task, not a wait for time: Blockly fires its events a frame and then a task after a change
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/**
 * Until what was changed has been drawn and told: Blockly fires its events a
 * frame and then a task after a change (events/utils.ts fireInternal), and
 * what its listeners do in turn fires on the next round.
 */
const settle = async () => {
    for (let i = 0; i < 3; i++) {
        await frame();
        await task();
    }
};

async function until<T>(what: string, look: () => T | null | undefined | false): Promise<T> {
    const deadline = performance.now() + 15_000;
    for (;;) {
        const found = look();
        if (found) return found;
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}; the page shows: ${document.body.innerText.slice(0, 600)}`);
        await frame();
    }
}

async function input(calls: { method: string; params: Record<string, unknown> }[]): Promise<void> {
    const answer = await fetch("/input", { method: "POST", body: JSON.stringify({ calls }) });
    if (!answer.ok) throw new Error(`the test's input failed: ${await answer.text()}`);
}
const press = (key: "Enter") =>
    input([
        { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key, code: key, windowsVirtualKeyCode: 13, text: "\r" } },
        { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key, code: key, windowsVirtualKeyCode: 13 } },
    ]);
const typeText = (text: string) => input([{ method: "Input.insertText", params: { text } }]);
const clickAt = (el: Element) => {
    const r = el.getBoundingClientRect();
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2, button: "left", clickCount: 1 };
    return input([
        { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...at } },
        { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...at } },
    ]);
};

/** The innermost element matching `selector` whose text is (or ends with) `text`. */
function byText(selector: string, text: string, root: ParentNode = document): HTMLElement | undefined {
    const all = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.textContent?.trim().endsWith(text));
    return all.find((el) => !all.some((other) => other !== el && el.contains(other)));
}
const openDialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');

function canvas(): Blockly.WorkspaceSvg | undefined {
    return Blockly.Workspace.getAll().find((w): w is Blockly.WorkspaceSvg => w.rendered && !(w as Blockly.WorkspaceSvg).isFlyout && !!(w as Blockly.WorkspaceSvg).getFlyout());
}

const logged = (message: string) => serviceState.current().log.some((entry: LogEntry) => entry.message === message);
/** The service logs each line, in order, and the page has heard the last one. */
async function say(...messages: string[]): Promise<void> {
    await ask("say", { lines: messages });
    await until(`"${messages.at(-1)}" in the page's log`, () => logged(messages.at(-1)!));
}
/** Another window makes a project, with a block on it so it's kept: the list is announced again. */
const madeElsewhere = async (name: string) => {
    const made = await ask<{ id: string }>("window", { do: "call", name: "createProject", input: { name } });
    await ask("window", { do: "call", name: "saveFlows", input: { project: made.id, flows: { workspace: { blocks: { languageVersion: 0, blocks: [{ type: BUILTIN.onRun, id: "elsewhere", x: 0, y: 0 }] } }, schemas: {} }, preview: null } });
    await until(`${name} in the page's list`, () => serviceState.current().projects.some((p) => p.name === name));
};
/** The Fixture Panel registers its blocks again: every window hears the registry changed. */
const registryChanged = () => ask("fixture", { do: "register" });

/** A log line arrives: rows already shown stay as they are, and a reader scrolled up stays there. */
async function consoleChecks() {
    await say(...Array.from({ length: 30 }, (_, i) => `line ${i}`));
    const panel = await until("the console", () => document.querySelector('[title="Clear Console"]')?.closest<HTMLElement>('[class*="_panel_"]'));
    const rows = () => [...panel.querySelectorAll<HTMLElement>('[class*="_line_"]')];
    await until("30 console rows", () => rows().length === 30);
    const body = rows()[0]!.parentElement!;
    const fromEnd = () => Math.round(body.scrollHeight - body.scrollTop - body.clientHeight);
    await settle();
    const startsAtEnd = fromEnd();
    const before = rows();
    // the reader selects a line to copy it
    const selected = before[3]!.querySelector('[class*="_text_"]')!;
    const range = document.createRange();
    range.selectNodeContents(selected);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await say("one more");
    await settle();
    const after = rows();
    const selection = getSelection()!;
    const lineCheck = {
        rows: after.length,
        rowsKept: before.filter((row, i) => after[i] === row && row.isConnected).length,
        newRowText: after.at(-1)?.querySelector('[class*="_text_"]')?.textContent ?? "",
        selection: selection.toString(),
        selectionInPage: Boolean(selection.anchorNode?.isConnected),
    };
    const followedAtEnd = fromEnd();
    body.scrollTop = 0;
    await settle();
    await say("while reading", "while reading, again");
    await settle();
    const stayedWhileReading = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    await settle();
    await say("after coming back");
    await settle();
    const followedAgain = fromEnd();
    // a long entry wraps: its time sits on its first line
    await say("a very long line ".repeat(30));
    await settle();
    const wrapped = rows().at(-1)!;
    const time = wrapped.querySelector<HTMLElement>('[class*="_time_"]')!.getBoundingClientRect();
    const text = wrapped.querySelector<HTMLElement>('[class*="_text_"]')!.getBoundingClientRect();
    return {
        ...lineCheck,
        startsAtEnd,
        followedAtEnd,
        stayedWhileReading,
        followedAgain,
        timeTopMinusTextTop: Math.round(time.top - text.top),
        textLines: Math.round(text.height / parseFloat(getComputedStyle(wrapped).lineHeight)),
    };
}

/** The Paperboard window at its narrowest, as the panel gets it beside the app's sidebar. */
const NARROWEST = { width: 620, height: 520 };

/**
 * The console and the Library, with log lines shown: the console is opaque,
 * so the blocks under it don't show through its lines, and never reaches
 * over the Library; in the narrowest window the Library leaves the canvas
 * as much room as it takes.
 */
async function layoutChecks() {
    const panel = document.querySelector<HTMLElement>('[title="Clear Console"]')!.closest<HTMLElement>('[class*="_panel_"]')!;
    const look = () => {
        const host = canvas()!.getInjectionDiv().getBoundingClientRect();
        const library = canvas()!.getFlyout()!.getWorkspace().getParentSvg().getBoundingClientRect();
        const log = panel.getBoundingClientRect();
        return {
            libraryWidth: Math.round(library.width),
            canvasRoom: Math.round(host.right - library.right),
            consoleOverLibrary: Math.round(library.right - log.left),
            consoleOutside: Math.round(log.right - host.right),
        };
    };
    const background = getComputedStyle(panel).backgroundColor;
    const [, , , alpha] = background.match(/[\d.]+/g)!.map(Number);
    const wide = look();
    await shoot("console");
    await viewport(NARROWEST);
    await settle();
    const narrow = look();
    await viewport(null);
    await settle();
    for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await settle();
        await fetch("/screenshot", { method: "POST", body: JSON.stringify({ name: `console-narrowest-${theme}`, ...NARROWEST }) });
    }
    document.documentElement.removeAttribute("data-paperui-theme");
    await settle();
    return { alpha: alpha ?? 1, backdrop: getComputedStyle(panel).backdropFilter, wide, narrow, back: look() };
}

/** The project list changes under the editor's Rename and Delete dialogs. */
async function dialogChecks() {
    const menu = async (item: string) => {
        byText("button, [role=menuitem]", "Project")!.click();
        (await until(`the Project menu's ${item}`, () => byText("[role=menuitem]", item)))!.click();
        return until(`the ${item} dialog`, openDialog);
    };
    const rename = await menu("Rename");
    const field = await until("the dialog's name field", () => rename.querySelector<HTMLInputElement>("input"));
    await settle();
    field.focus();
    field.select();
    await typeText("Renamed by hand");
    const typed = field.value;
    // another window makes a project: the list is announced again
    await madeElsewhere("Made elsewhere");
    await settle();
    const renameKept = field.value;
    byText("button", "Rename", rename)!.click();
    await until("the Rename dialog to close", () => !openDialog());
    const renamedTo = calls().filter((c) => c.name === "updateProject").at(-1)?.input.name;
    await settle();

    refuse("deleteProject", true);
    const remove = await menu("Delete");
    await settle();
    byText("button", "Delete", remove)!.click();
    await until("the delete to fail in the dialog", () => remove.querySelector('[role="alert"]'));
    await madeElsewhere("Also made elsewhere");
    await settle();
    const deleteError = remove.querySelector('[role="alert"]')?.textContent ?? "";
    byText("button", "Cancel", remove)!.click();
    await until("the Delete dialog to close", () => !openDialog());
    refuse("deleteProject", false);
    await settle();
    return { typed, renameKept, renamedTo, deleteError };
}

const railItem = (name: string) => until(`${name} in the Library's rail`, () => byText("[role=radio], button, label", name));
const variableNames = () => canvas()!.getVariableMap().getAllVariables().map((v) => v.getName());

/** The Library keeps its place while its list is drawn again, and starts at the top for another list. */
async function libraryChecks() {
    (await railItem("Variables")).click();
    await settle();
    const map = canvas()!.getVariableMap();
    for (let i = 1; i <= 40; i++) map.createVariable(`counter_${i}`);
    await settle();
    const list = canvas()!.getFlyout()!.getWorkspace();
    const startY = list.scrollY;
    list.scrollbar!.setY(600);
    await settle();
    const scrolledY = list.scrollY;
    map.createVariable("made_while_reading");
    await settle();
    const afterCreate = list.scrollY;
    map.renameVariable(map.getVariable("counter_5")!, "renamed_while_reading");
    await settle();
    const afterRename = list.scrollY;
    (await railItem("Logic")).click();
    await settle();
    const otherCategory = list.scrollY;
    (await railItem("Variables")).click();
    await settle();
    const backAgain = list.scrollY;
    return { startY, scrolledY, afterCreate, afterRename, otherCategory, backAgain };
}

/** "Create variable": the name field has the keyboard as it opens, and Enter makes one variable and closes. */
async function createVariableChecks() {
    const before = variableNames().length;
    const button = await until("the Create variable button", () => byText("button", "Create variable"));
    await clickAt(button);
    const dialog = await until("the variable name dialog", openDialog);
    const field = await until("the name field", () => dialog.querySelector<HTMLInputElement>('input[placeholder="Name"]'));
    await settle();
    const focusedOnOpen = document.activeElement === field;
    // the rest is checked whether or not the field had the keyboard
    if (!focusedOnOpen) field.focus();
    await typeText("score");
    await press("Enter");
    await settle();
    const names = variableNames();
    return {
        focusedOnOpen,
        made: names.filter((n) => n === "score").length,
        added: names.length - before,
        dialogOpen: Boolean(openDialog()),
    };
}

/** The editor's switch moves, with its thump, once the service has switched the flows. */
async function toggleChecks() {
    const toggle = await until("the editor's switch", () => document.querySelector<HTMLElement>('[role="switch"][aria-label="Flows start on their events"]'));
    let animated = false;
    const watch = new MutationObserver(() => (animated ||= /animating/.test(toggle.className)));
    watch.observe(toggle, { attributes: true, attributeFilter: ["class"] });
    const before = toggle.getAttribute("aria-checked");
    await clickAt(toggle);
    await until("the switch to move", () => toggle.getAttribute("aria-checked") !== before);
    await frame();
    watch.disconnect();
    const moved = { before, after: toggle.getAttribute("aria-checked"), animated, saved: calls().filter((c) => c.name === "updateProject").at(-1)?.input.enabled };

    // a flip the service refuses is said, and the notice goes once a flip goes through
    const notice = () => [...document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]')].find((el) => el.textContent?.includes("Flows not turned"));
    refuse("updateProject", true);
    await clickAt(toggle);
    const refused = (await until("the refused flip's notice", notice))!.textContent ?? "";
    refuse("updateProject", false);
    await clickAt(toggle);
    await until("the switch to move back", () => toggle.getAttribute("aria-checked") === before);
    await settle();
    const noticeAfterRetry = notice()?.textContent ?? null;
    await clickAt(toggle);
    await until("the switch to move again", () => toggle.getAttribute("aria-checked") !== before);
    await settle();
    return { ...moved, refused, noticeAfterRetry };
}

/**
 * Two registry changes, the first one's listing held on its way back while
 * the Late Panel starts offering a block: the Library shows the newer.
 */
async function registryChecks() {
    holdNextList();
    await registryChanged();
    await until("the first listing's answer, held", () => held() === 1);
    await ask("late", { do: "start" });
    await settle();
    release();
    const lateShown = await until("the Late Panel in the Library's rail", () => byText("[role=radio], button, label", LATE_PANEL_NAME)).then(
        () => true,
        (err: unknown) => {
            throw new Error(`the newer registry never showed: ${err instanceof Error ? err.message : String(err)}`);
        },
    );
    return { lateShown };
}

/** Flows that don't load leave the canvas read-only and say so until they do; Try again loads them. */
async function loadFailureChecks() {
    (await until("the All projects button", () => document.querySelector<HTMLElement>('[aria-label="All projects"]'))).click();
    const card = await until("the project's card", () => byText("*", "Renamed by hand"));
    refuse("loadFlows", true);
    card.click();
    const alert = await until("the load failure", () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find((el) => el.textContent?.includes("Your flows couldn't be loaded")));
    await settle();
    // the app switches theme meanwhile: Blockly draws its list again, which stays hidden
    document.documentElement.setAttribute("data-theme", "dark");
    await settle();
    const failed = {
        text: alert.textContent ?? "",
        readOnly: canvas()!.isReadOnly(),
        dismissable: Boolean(alert.querySelector('[aria-label="Dismiss"]')),
        library: Boolean(byText("[role=radio], button, label", "Logic")) || getComputedStyle(canvas()!.getFlyout()!.getWorkspace().getParentSvg()).display !== "none",
    };
    document.documentElement.removeAttribute("data-theme");
    refuse("loadFlows", false);
    byText("button", "Try again", alert)!.click();
    await until("the failure to go", () => !alert.isConnected);
    await settle();
    return { failed, retried: { readOnly: canvas()!.isReadOnly(), library: Boolean(byText("[role=radio], button, label", "Logic")) } };
}

const backButton = () => document.querySelector<HTMLElement>('[aria-label="All projects"]');
/** The editor is open on `name` and its canvas takes edits. */
const editing = async (name: string) => {
    await until(`the editor of ${name}`, () => document.querySelector(`[role="menubar"][aria-label="${name}"]`) && canvas() && !canvas()!.isReadOnly());
    await railItem("Flow");
    await settle();
};
/** A block dropped on the canvas, which is saved a moment later (or at once, when the editor is left). */
const addBlock = async (id: string) => {
    Blockly.serialization.blocks.append({ type: BUILTIN.onRun, id, x: 40, y: 40 }, canvas()!);
    // Blockly tells the editor a tick later, as it does a person's drop
    await frame();
};
const callsOf = (name: string) => calls().filter((c) => c.name === name);
const saveHolding = (blockId: string) => calls().findIndex((c) => c.name === "saveFlows" && JSON.stringify(c.input.flows).includes(`"${blockId}"`));
/** Home is shown: what was called by then. */
const home = async () => {
    await until("the home screen", () => !backButton() && byText("button", "New project"));
    return calls().length;
};

/** Leaving the editor saves the latest edit first, and a new project left without a block is dropped. */
async function leaveChecks() {
    // the back arrow, before the edit's own save was due
    await addBlock("edit-before-back");
    backButton()!.click();
    const callsAtHome = await home();
    const savedBeforeHome = saveHolding("edit-before-back") >= 0 && saveHolding("edit-before-back") < callsAtHome;

    // New project from the editor's menu: the edit is saved before anything is made
    (await until("the project's card", () => byText("*", "Renamed by hand")))!.click();
    await editing("Renamed by hand");
    await addBlock("edit-before-new");
    byText("button, [role=menuitem]", "Project")!.click();
    (await until("the Project menu's New project", () => byText("[role=menuitem]", "New project")))!.click();
    await editing("Untitled project");
    const savedBeforeMade = saveHolding("edit-before-new") >= 0 && saveHolding("edit-before-new") < calls().findIndex((c) => c.name === "createProject");
    const emptyDraft = callsOf("createProject").length;

    // left empty, it is dropped
    const emptyId = (await until("the new project's id", () => serviceState.current().projects.find((p) => p.draft)))!.id;
    backButton()!.click();
    await home();
    const droppedEmpty = callsOf("deleteProject").at(-1)?.input;

    // given a block, it is saved before the service could be asked to drop it, so the service keeps it
    byText("button", "New project")!.click();
    await editing("Untitled project");
    const keptId = (await until("the new project's id", () => serviceState.current().projects.find((p) => p.draft)))!.id;
    await addBlock("edit-in-draft");
    backButton()!.click();
    await home();
    const keptDelete = calls().findIndex((c) => c.name === "deleteProject" && c.input.project === keptId);
    return {
        savedBeforeHome,
        savedBeforeMade,
        emptyDraft,
        droppedEmpty,
        emptyId,
        keptSavedFirst: saveHolding("edit-in-draft") >= 0 && (keptDelete === -1 || saveHolding("edit-in-draft") < keptDelete),
        keptAsked: calls()[keptDelete]?.input,
        keptId,
        keptListed: serviceState.current().projects.some((p) => p.id === keptId),
    };
}

/**
 * Opening a project is not editing it: the load, a theme change and a
 * registry change all reach Blockly's change listener, and none of them is
 * saved, so the project is not stamped as just edited. Not when it is left
 * again either, which saves what is new first.
 */
async function openChecks() {
    const name = "Renamed by hand";
    const saves = () => callsOf("saveFlows").length;
    const before = saves();
    (await until(`${name}'s card`, () => byText("*", name)))!.click();
    await editing(name);
    await until("the project's blocks on the canvas", () => canvas()!.getTopBlocks(false).length > 0);
    await settle();
    // drawn in both themes, which Blockly reports as changes
    await shoot("editor-opened");
    await registryChanged();
    await settle();
    backButton()!.click();
    await home();
    return { saves: saves() - before };
}

const alertSaying = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find((el) => el.textContent?.includes(text));
/** the window resized to `width` by `height`, or back to its own size with none */
async function viewport(size: { width: number; height: number } | null): Promise<void> {
    const answer = await fetch("/viewport", { method: "POST", body: JSON.stringify(size) });
    if (!answer.ok) throw new Error(`the resize failed: ${await answer.text()}`);
}
const PHONE = { width: 390, height: 844 };
const phoneScreen = () => byText("*", "Blocks isn't on phones yet");

/**
 * No edit goes without a word: a save the service refuses is said until one
 * goes through, and Paperboard is told the page holds unsaved work, so it
 * asks before a restart; asked, the editor saves, or asks the person when it
 * can't. An editor closed straight after an edit (the window narrowed to a
 * phone's) sends it as it goes, and one whose save fails then says so on the
 * page that's left.
 */
async function unsavedChecks() {
    const name = "Renamed by hand";
    (await until(`${name}'s card`, () => byText("*", name)))!.click();
    await editing(name);
    const askedBefore = holdsUnsaved();
    refuse("saveFlows", true);
    await addBlock("edit-refused");
    const refused = (await until("the refused save's notice", () => alertSaying(NOT_SAVED)))!.textContent ?? "";
    await until("Paperboard told of the unsaved work", () => holdsUnsaved());
    // Paperboard is about to restart the panel: the save fails again, so the person is asked
    const asking = askLeave();
    const dialog = await until("the unsaved changes dialog", openDialog);
    const dialogText = dialog.textContent ?? "";
    await shoot("unsaved-dialog");
    byText("button", "Stay", dialog)!.click();
    const stayAnswer = await asking;
    await until("the dialog to close", () => !openDialog());
    // the service takes saves again: asked again, the editor saves, and the panel may restart
    refuse("saveFlows", false);
    const leaveAnswer = await askLeave();
    await settle();
    const afterSave = { saved: saveHolding("edit-refused") >= 0, notice: alertSaying(NOT_SAVED)?.textContent ?? null, asks: holdsUnsaved() };

    // an edit, and at once the window is a phone's: the editor closes, sending it
    await addBlock("edit-before-narrow");
    await viewport(PHONE);
    await until("the phone screen", phoneScreen);
    const sentOnClose = saveHolding("edit-before-narrow") >= 0;
    await viewport(null);
    await home();

    // the same, but the save fails: the phone screen says so, and so does home once the window is wide again
    (await until(`${name}'s card`, () => byText("*", name)))!.click();
    await editing(name);
    refuse("saveFlows", true);
    await addBlock("edit-lost-on-close");
    await viewport(PHONE);
    const onPhone = (await until("the failure on the phone screen", () => phoneScreen() && alertSaying(NOT_SAVED)))!.textContent ?? "";
    await viewport(null);
    refuse("saveFlows", false);
    await shoot("closed-unsaved", true);
    const onHome = (await until("the failure on home", () => byText("button", "New project") && alertSaying(NOT_SAVED)))!;
    const homeText = onHome.textContent ?? "";
    onHome.querySelector<HTMLElement>('[aria-label="Dismiss"]')!.click();
    await settle();
    return { askedBefore, refused, dialogText, stayAnswer, leaveAnswer, afterSave, sentOnClose, onPhone, homeText, dismissed: !alertSaying(NOT_SAVED) };
}

/**
 * What the page shows now, at desktop width in both themes, saved by the
 * harness when BLOCKS_FIXTURE_SHOTS names a folder (a person looks at them).
 * At a phone's width too with `phone`: the panel shows its phone screen
 * there, so what was open is closed, and home shows once it is wide again.
 */
async function shoot(name: string, phone = false): Promise<void> {
    for (const theme of ["light", "dark"]) {
        // the theme as the shell gives it to a panel
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await settle();
        for (const [size, width, height] of [["desktop", 1280, 800], ...(phone ? ([["phone", PHONE.width, PHONE.height]] as const) : [])] as const) {
            const answer = await fetch("/screenshot", { method: "POST", body: JSON.stringify({ name: `${name}-${size}-${theme}`, width, height }) });
            if (!answer.ok) throw new Error(`the screenshot failed: ${await answer.text()}`);
        }
    }
    document.documentElement.removeAttribute("data-paperui-theme");
    await settle();
}

/**
 * Home: a switch that didn't move says why until a switch moves, and the
 * service's own trouble driving projects shows until it says it is over.
 */
async function homeChecks() {
    await home();
    const name = "Renamed by hand";
    const toggle = await until("the card's switch", () => document.querySelector<HTMLElement>(`[role="switch"][aria-label="${name}: flows start on their events"]`));
    const alert = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find((el) => el.textContent?.includes(text));
    const before = toggle.getAttribute("aria-checked");
    refuse("updateProject", true);
    await clickAt(toggle);
    const failed = (await until("the switch's failure", () => alert("Flows not turned")))!.textContent ?? "";
    await settle();
    const stayed = toggle.getAttribute("aria-checked");
    // the registry goes away as another window makes a project: the service can't tell the other panels
    await ask("registry", { away: true });
    await madeElsewhere("Made while the registry was away");
    const banner = (await until("the service's banner", () => alert("Flows can't drive projects")))!.textContent ?? "";
    await shoot("home-failed");

    // the registry is back: the switch that moves next tells the other panels, and the banner goes
    await ask("registry", { away: false });
    refuse("updateProject", false);
    await clickAt(toggle);
    await until("the switch to move", () => toggle.getAttribute("aria-checked") !== before);
    await until("the service's banner to go", () => !alert("Flows can't drive projects"));
    await settle();
    const after = {
        moved: toggle.getAttribute("aria-checked"),
        switchFailure: alert("Flows not turned")?.textContent ?? null,
        banner: alert("Flows can't drive projects")?.textContent ?? null,
    };
    await shoot("home-recovered");
    return { before, failed, stayed, banner, after };
}

async function run(): Promise<Record<string, unknown>> {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <App />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    (await until("the project's card", () => byText("*", "Serviced project")))!.click();
    await until("the canvas", () => canvas());
    await railItem("Flow");
    await settle();
    const consoleResult = await consoleChecks();
    const layout = await layoutChecks();
    const dialogs = await dialogChecks();
    const library = await libraryChecks();
    const createVariable = await createVariableChecks();
    const toggle = await toggleChecks();
    const refresh = await registryChecks();
    const loadFailure = await loadFailureChecks();
    const leaving = await leaveChecks();
    const opening = await openChecks();
    const unsavedWork = await unsavedChecks();
    const homeScreen = await homeChecks();
    return { console: consoleResult, layout, dialogs, library, createVariable, toggle, refresh, loadFailure, leaving, opening, unsavedWork, home: homeScreen, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
