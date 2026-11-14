// The whole panel in a real browser (App, as index.tsx mounts it) over a
// service that announces its state the way the daemon delivers it
// (serviceStub.ts): every announcement arrives as new objects. A person opens
// a project and uses it while the service keeps announcing: log lines arrive,
// the project list changes under an open dialog, variables are made and
// renamed while the Library is scrolled. What the page kept through each is
// posted back to the test as JSON. Keys and clicks that matter as a person's
// own (Enter, the click that leaves focus on a button) are sent through
// DevTools (/input), so Chrome handles them as trusted input.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { SERVICE_CALLS, type LogEntry } from "../../src/panel";
import { BUILTIN } from "../../src/lib/names";
import { project, registry, service, SERVICED_PROJECT } from "./serviceStub";

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/**
 * Until what was changed has been drawn and told: Blockly fires its events a
 * frame and then a task after a change (events/utils.ts fireInternal), and
 * what its listeners do in turn fires on the next round, as do the stub
 * service's answers (a task each).
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

let nextLog = 1;
const logLine = (message: string): LogEntry => ({ id: nextLog++, at: Date.now(), level: "info", message, project: SERVICED_PROJECT });
const say = (...messages: string[]) => service.announce({ log: [...service.state().log, ...messages.map(logLine)] });

/** A log line arrives: rows already shown stay as they are, and a reader scrolled up stays there. */
async function consoleChecks() {
    say(...Array.from({ length: 30 }, (_, i) => `line ${i}`));
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
    say("one more");
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
    say("while reading", "while reading, again");
    await settle();
    const stayedWhileReading = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    await settle();
    say("after coming back");
    await settle();
    const followedAgain = fromEnd();
    // a long entry wraps: its time sits on its first line
    say("a very long line ".repeat(30));
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
    service.announce({ projects: [...service.state().projects, project("p-other", "Made elsewhere", Date.now())] });
    await settle();
    const renameKept = field.value;
    byText("button", "Rename", rename)!.click();
    await until("the Rename dialog to close", () => !openDialog());
    const renamedTo = service.calls().filter((c) => c.name === SERVICE_CALLS.updateProject).at(-1)?.input.name;
    await settle();

    service.fail(SERVICE_CALLS.deleteProject, "the disk is full");
    const remove = await menu("Delete");
    await settle();
    byText("button", "Delete", remove)!.click();
    await until("the delete to fail in the dialog", () => remove.querySelector('[role="alert"]'));
    service.announce({ projects: [...service.state().projects, project("p-third", "Also made elsewhere", Date.now())] });
    await settle();
    const deleteError = remove.querySelector('[role="alert"]')?.textContent ?? "";
    byText("button", "Cancel", remove)!.click();
    await until("the Delete dialog to close", () => !openDialog());
    service.fail(SERVICE_CALLS.deleteProject, null);
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
    const moved = { before, after: toggle.getAttribute("aria-checked"), animated, saved: service.calls().filter((c) => c.name === SERVICE_CALLS.updateProject).at(-1)?.input.enabled };

    // a flip the service refuses is said, and the notice goes once a flip goes through
    const notice = () => [...document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]')].find((el) => el.textContent?.includes("Flows not turned"));
    service.fail(SERVICE_CALLS.updateProject, "the disk is full");
    await clickAt(toggle);
    const refused = (await until("the refused flip's notice", notice))!.textContent ?? "";
    service.fail(SERVICE_CALLS.updateProject, null);
    await clickAt(toggle);
    await until("the switch to move back", () => toggle.getAttribute("aria-checked") === before);
    await settle();
    const noticeAfterRetry = notice()?.textContent ?? null;
    await clickAt(toggle);
    await until("the switch to move again", () => toggle.getAttribute("aria-checked") !== before);
    await settle();
    return { ...moved, refused, noticeAfterRetry };
}

/** Two registry changes whose answers come back in the other order: the Library shows the newer. */
async function registryChecks() {
    const release = registry.hold();
    registry.changed();
    registry.offer({ id: "dev.test.late", name: "Late Panel" } as never, { panelId: "dev.test.late", entry: "command.wave", schema: { kind: "command", id: "wave", name: "Wave", text: "Wave" } } as never);
    registry.changed();
    await settle();
    release();
    await settle();
    await settle();
    return { lateShown: Boolean(byText("[role=radio], button, label", "Late Panel")) };
}

/** Flows that don't load leave the canvas read-only and say so until they do; Try again loads them. */
async function loadFailureChecks() {
    (await until("the All projects button", () => document.querySelector<HTMLElement>('[aria-label="All projects"]'))).click();
    const card = await until("the project's card", () => byText("*", "Renamed by hand"));
    service.fail(SERVICE_CALLS.load, "the service is restarting");
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
    service.fail(SERVICE_CALLS.load, null);
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
const callsOf = (name: string) => service.calls().filter((c) => c.name === name);
const saveHolding = (blockId: string) => service.calls().findIndex((c) => c.name === SERVICE_CALLS.save && JSON.stringify(c.input.flows).includes(`"${blockId}"`));
/** Home is shown: what was called by then. */
const home = async () => {
    await until("the home screen", () => !backButton() && byText("button", "New project"));
    return service.calls().length;
};

/** Leaving the editor saves the latest edit first, and a new project left without a block is dropped. */
async function leaveChecks() {
    // the back arrow, before the edit's own save was due
    await addBlock("edit-before-back");
    backButton()!.click();
    const callsAtHome = await home();
    const savedBeforeHome = saveHolding("edit-before-back") >= 0 && saveHolding("edit-before-back") < callsAtHome;

    // New project from the editor's menu: the edit is saved before anything is made
    byText("*", "Renamed by hand")!.click();
    await editing("Renamed by hand");
    await addBlock("edit-before-new");
    byText("button, [role=menuitem]", "Project")!.click();
    (await until("the Project menu's New project", () => byText("[role=menuitem]", "New project")))!.click();
    await editing("Untitled project");
    const savedBeforeMade = saveHolding("edit-before-new") >= 0 && saveHolding("edit-before-new") < service.calls().findIndex((c) => c.name === SERVICE_CALLS.createProject);
    const emptyDraft = callsOf(SERVICE_CALLS.createProject).length;

    // left empty, it is dropped
    const emptyId = (await until("the new project's id", () => service.state().projects.find((p) => p.draft)))!.id;
    backButton()!.click();
    await home();
    const droppedEmpty = callsOf(SERVICE_CALLS.deleteProject).at(-1)?.input;

    // given a block, it is saved before the service is asked to drop it, so the service keeps it
    byText("button", "New project")!.click();
    await editing("Untitled project");
    const keptId = service.state().projects.find((p) => p.draft)!.id;
    await addBlock("edit-in-draft");
    backButton()!.click();
    await home();
    const keptDelete = service.calls().findIndex((c) => c.name === SERVICE_CALLS.deleteProject && c.input.project === keptId);
    return {
        savedBeforeHome,
        savedBeforeMade,
        emptyDraft,
        droppedEmpty,
        emptyId,
        keptSavedFirst: saveHolding("edit-in-draft") >= 0 && saveHolding("edit-in-draft") < keptDelete,
        keptAsked: service.calls()[keptDelete]?.input,
        keptId,
        keptListed: service.state().projects.some((p) => p.id === keptId),
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
    const saves = () => callsOf(SERVICE_CALLS.save).length;
    const before = saves();
    byText("*", name)!.click();
    await editing(name);
    await until("the project's blocks on the canvas", () => canvas()!.getTopBlocks(false).length > 0);
    await settle();
    // drawn in both themes, which Blockly reports as changes
    await shoot("editor-opened");
    registry.changed();
    await settle();
    backButton()!.click();
    await home();
    return { saves: saves() - before };
}

/**
 * What the page shows now, at phone and desktop width in both themes, saved
 * by the harness when BLOCKS_FIXTURE_SHOTS names a folder (a person looks at them).
 */
async function shoot(name: string): Promise<void> {
    for (const theme of ["light", "dark"]) {
        // the theme as the shell gives it to a panel
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await settle();
        for (const [size, width, height] of [["phone", 390, 844], ["desktop", 1280, 800]] as const) {
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
    service.fail(SERVICE_CALLS.updateProject, "the disk is full");
    await clickAt(toggle);
    const failed = (await until("the switch's failure", () => alert("Flows not turned")))!.textContent ?? "";
    await settle();
    const stayed = toggle.getAttribute("aria-checked");
    service.announce({ blocksError: "The other panels weren't told the projects changed: the registry is away" });
    const banner = (await until("the service's banner", () => alert("Flows can't drive projects")))!.textContent ?? "";
    await shoot("home-failed");

    service.fail(SERVICE_CALLS.updateProject, null);
    await clickAt(toggle);
    await until("the switch to move", () => toggle.getAttribute("aria-checked") !== before);
    service.announce({ blocksError: null });
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
    const dialogs = await dialogChecks();
    const library = await libraryChecks();
    const createVariable = await createVariableChecks();
    const toggle = await toggleChecks();
    const refresh = await registryChecks();
    const loadFailure = await loadFailureChecks();
    const leaving = await leaveChecks();
    const opening = await openChecks();
    const homeScreen = await homeChecks();
    return { console: consoleResult, dialogs, library, createVariable, toggle, refresh, loadFailure, leaving, opening, home: homeScreen, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
