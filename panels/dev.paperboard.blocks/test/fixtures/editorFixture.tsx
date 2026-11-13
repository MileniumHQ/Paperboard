// The real editor in a real browser, used the way a person uses it: blocks
// are dragged out of the Library with pointer events, onto the canvas and
// into each other. What happened is posted back to the test as JSON.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Editor from "../../src/Editor";
import { createProjects } from "../../src/projects/state";
import { BUILTIN, registryBlockType } from "../../src/lib/names";
import { FIXTURE_PANEL, FIXTURE_PANEL_NAME, FIXTURE_PROJECT, saves } from "./paperapiStub";

/** Where on a block the pointer takes hold of it, from its top left. */
const GRIP = 8;
const GREET = registryBlockType({ kind: "command", panelId: FIXTURE_PANEL, entry: "command.greet" });

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until<T>(what: string, look: () => T | null | undefined | false): Promise<T> {
    const deadline = performance.now() + 15_000;
    for (;;) {
        const found = look();
        if (found) return found;
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await frame();
    }
}

/** The editor's canvas: the one drawn workspace that has the Library. */
function canvas(): Blockly.WorkspaceSvg | undefined {
    return Blockly.Workspace.getAll().find((w): w is Blockly.WorkspaceSvg => w.rendered && !(w as Blockly.WorkspaceSvg).isFlyout && !!(w as Blockly.WorkspaceSvg).getFlyout());
}

function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error(`nothing is drawn at ${x}, ${y}`);
    target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }),
    );
}

/** The Library's block of a type, once the list shows it. */
function libraryBlock(type: string): Promise<Blockly.BlockSvg> {
    return until(`${type} in the Library`, () =>
        canvas()
            ?.getFlyout()
            ?.getWorkspace()
            .getTopBlocks(false)
            .find((b) => b.type === type),
    );
}

interface Dragged {
    /** how far the dragged block's corner was from where the pointer held it, part way there */
    offBy: { x: number; y: number };
    /** the drop previews on the canvas just before the drop */
    previews: { drawn: boolean; icon: string }[];
}

/** Drags a Library block so that its top left lands on a point of the page; `early` runs a few moves in. */
async function drag(type: string, to: { x: number; y: number }, early?: () => void): Promise<Dragged> {
    const from = (await libraryBlock(type)).getSvgRoot().getBoundingClientRect();
    const start = { x: from.left + GRIP, y: from.top + GRIP };
    const end = { x: to.x + GRIP, y: to.y + GRIP };
    const steps = 30;
    let offBy = { x: NaN, y: NaN };
    pointer("pointerdown", start.x, start.y);
    for (let i = 1; i <= steps; i++) {
        const at = { x: start.x + ((end.x - start.x) * i) / steps, y: start.y + ((end.y - start.y) * i) / steps };
        pointer("pointermove", at.x, at.y);
        await frame();
        if (i === 3) early?.();
        if (i === steps / 2) {
            const held = document.querySelector(".blocklyDragging")?.getBoundingClientRect();
            if (held) offBy = { x: held.left - (at.x - GRIP), y: held.top - (at.y - GRIP) };
        }
    }
    // the preview is placed a frame after the block comes near
    await frame();
    await frame();
    // Blockly keeps its previews off the list of the canvas's blocks, so they're found as drawn
    const previews = [...document.querySelectorAll<SVGGElement>("g.blocklyInsertionMarker")]
        .filter((el) => !el.parentElement?.closest(".blocklyInsertionMarker"))
        .map((el) => ({
            drawn: el.getAttribute("visibility") !== "hidden" && !!el.querySelector(":scope > .blocklyPath")?.getAttribute("d"),
            icon: el.querySelector(":scope > g > .paperBlockSymbol:not(.paperBlockGear)")?.textContent ?? "",
        }));
    pointer("pointerup", end.x, end.y);
    await frame();
    return { offBy, previews };
}

/** Where a block's connection is on the page. */
function onPage(connection: Blockly.Connection): { x: number; y: number } {
    const at = Blockly.utils.svgMath.wsToScreenCoordinates(canvas()!, new Blockly.utils.Coordinate(connection.x, connection.y));
    return { x: at.x, y: at.y };
}

/** What the editor has saved once a save holds `blocks` blocks (typed-in values aside), with the canvas as it is then. */
async function savedWith(blocks: number) {
    const count = (b: { inputs?: Record<string, { block?: unknown }>; next?: { block?: unknown } } | undefined): number =>
        b ? 1 + Object.values(b.inputs ?? {}).reduce((n, input) => n + count(input.block as never), 0) + count(b.next?.block as never) : 0;
    await until(`a save of ${blocks} blocks`, () => (saves.at(-1)?.workspace.blocks?.blocks ?? []).reduce((n, b) => n + count(b as never), 0) === blocks);
    // long enough for a save of anything that came after: a block nobody dropped would be in it
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
        saved: saves.at(-1)!.workspace.blocks?.blocks ?? [],
        onCanvas: canvas()!
            .getAllBlocks(false)
            .map((b) => b.type)
            .sort(),
        alert: document.querySelector('[role="alert"]')?.textContent ?? "",
    };
}

async function run(): Promise<Record<string, unknown>> {
    const projects = createProjects();
    const project = await until("the project", () => projects.find(FIXTURE_PROJECT));
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Editor projectId={FIXTURE_PROJECT} project={() => project} projects={projects} onHome={() => {}} onOpen={() => {}} />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    await libraryBlock(BUILTIN.onRun);
    const stage = canvas()!.getInjectionDiv().getBoundingClientRect();

    // a block onto the empty canvas, as the canvas changes size (the window is resized, say)
    const narrowed = stage.width - 200;
    const first = await drag(BUILTIN.onRun, { x: stage.left + narrowed * 0.6, y: stage.top + stage.height * 0.3 }, () => {
        const root = document.querySelector<HTMLElement>(".paperui-root")!;
        root.style.width = `${root.offsetWidth - 200}px`;
    });
    const afterFirst = await savedWith(1);
    const fitted = canvas()!.getParentSvg().getBoundingClientRect().width === narrowed;

    // a block into another: the drag that shows a drop preview
    const trigger = await until("the trigger on the canvas", () => canvas()!.getTopBlocks(false).find((b) => b.type === BUILTIN.onRun));
    const second = await drag("controls_if", onPage(trigger.getInput("DO")!.connection!));
    const afterSecond = await savedWith(2);

    // a panel's block into that one
    const rail = await until("the panel in the Library's rail", () => [...document.querySelectorAll<HTMLElement>("[role=radio], button, label")].find((el) => el.textContent?.trim().endsWith(FIXTURE_PANEL_NAME)));
    rail.click();
    const inner = canvas()!
        .getAllBlocks(false)
        .find((b) => b.type === "controls_if")!;
    const third = await drag(GREET, onPage(inner.getInput("DO0")!.connection!));
    const afterThird = await savedWith(3);

    const uncaught = [...errors];
    // what nothing catches is said on the page, by PaperProvider's toast: once, however often it's thrown
    for (let i = 0; i < 3; i++) window.dispatchEvent(new ErrorEvent("error", { error: new Error("the fixture's own failure"), message: "the fixture's own failure" }));
    await until("the failure on the page", () => document.querySelector('[aria-label="Notifications"] [role="alert"]'));
    await frame();
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((el) => ({ toast: !!el.closest('[aria-label="Notifications"]'), text: el.textContent ?? "" }));

    return { first, afterFirst, fitted, second, afterSecond, third, afterThird, uncaught, alerts, greet: GREET };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
