// The whole panel in a real browser (App, as index.tsx mounts it) over the
// real service, on a real daemon (test/browserFixture.ts): every state it
// announces arrives as new objects. A person opens a project and uses it
// while the service keeps announcing: the registry changes under the Library,
// flows fail to load, an edit is left unsaved. A call the service refuses is
// sent for a project it doesn't have (fixtures/wire.ts). What the page kept
// through each is posted back to the test as JSON.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { NOT_SAVED } from "../../src/editorFlows";
import { serviceState } from "../../src/bridge";
import { ask, askLeave, calls, held, holdNextList, holdsUnsaved, refuse, release } from "./wire";
import { LATE_PANEL_NAME } from "./world";
import { BUILTIN } from "../../src/lib/names";

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

/** The innermost element matching `selector` whose text is (or ends with) `text`. */
function byText(selector: string, text: string, root: ParentNode = document): HTMLElement | undefined {
    const all = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.textContent?.trim().endsWith(text));
    return all.find((el) => !all.some((other) => other !== el && el.contains(other)));
}
const openDialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');

function canvas(): Blockly.WorkspaceSvg | undefined {
    return Blockly.Workspace.getAll().find((w): w is Blockly.WorkspaceSvg => w.rendered && !(w as Blockly.WorkspaceSvg).isFlyout && !!(w as Blockly.WorkspaceSvg).getFlyout());
}

/** The Fixture Panel registers its blocks again: every window hears the registry changed. */
const registryChanged = () => ask("fixture", { do: "register" });

const railItem = (name: string) => until(`${name} in the Library's rail`, () => byText("[role=radio], button, label", name));

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
    const card = await until("the project's card", () => byText("*", "Serviced project"));
    refuse("loadFlows", true);
    card.click();
    // the canvas says why it couldn't load, over where the flows would be, with its own Try again
    const error = await until("the canvas's error", () => errorTitled("Couldn't load your flows"));
    const cover = error.closest<HTMLElement>("[class*=cover]")!;
    await settle();
    await settle();
    const failed = {
        text: error.textContent ?? "",
        covers: Boolean(cover),
        // a standing failure is said in place, never in a toast that goes while it stays
        toasted: Boolean(alertSaying("Couldn't load your flows")),
        readOnly: canvas()!.isReadOnly(),
        retryOnCanvas: Boolean(byText("button", "Try again", cover)),
        library: Boolean(byText("[role=radio], button, label", "Logic")) || getComputedStyle(canvas()!.getFlyout()!.getWorkspace().getParentSvg()).display !== "none",
    };
    refuse("loadFlows", false);
    byText("button", "Try again", cover)!.click();
    await until("the failure to go", () => !cover.isConnected && !errorTitled("Couldn't load your flows"));
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
    (await until("the project's card", () => byText("*", "Serviced project")))!.click();
    await editing("Serviced project");
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

/** the PaperError in place titled `title` */
const errorTitled = (title: string) => document.querySelector<HTMLElement>(`[data-paper-error][aria-label="${title.replace(/"/g, '\\"')}"]`);
/** the failure toast saying `text` */
const alertSaying = (text: string) => [...document.querySelectorAll<HTMLElement>('[data-paper-toasts] [role="alert"]')].find((el) => el.textContent?.includes(text));
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
    const name = "Serviced project";
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
    onHome.querySelector<HTMLElement>('[aria-label="Close"]')!.click();
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
    const refresh = await registryChecks();
    const loadFailure = await loadFailureChecks();
    const leaving = await leaveChecks();
    const unsavedWork = await unsavedChecks();
    return { refresh, loadFailure, leaving, unsavedWork, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
