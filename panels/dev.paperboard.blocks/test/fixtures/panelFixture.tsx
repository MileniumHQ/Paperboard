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
import { project, service, SERVICED_PROJECT } from "./serviceStub";

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** long enough for Blockly's events (fired a tick later) and the effects after them */
const settle = async () => {
    for (let i = 0; i < 4; i++) await frame();
    await pause(200);
    for (let i = 0; i < 2; i++) await frame();
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
    await settle();
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
    const fromEnd = () => Math.round(body.scrollHeight - body.scrollTop - body.clientHeight);
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
    return { ...lineCheck, followedAtEnd, stayedWhileReading, followedAgain: fromEnd() };
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
    await pause(300);
    const names = variableNames();
    return {
        focusedOnOpen,
        made: names.filter((n) => n === "score").length,
        added: names.length - before,
        dialogOpen: Boolean(openDialog()),
    };
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
    return { console: consoleResult, dialogs, library, createVariable, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
