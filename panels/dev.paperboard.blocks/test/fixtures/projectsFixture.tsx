// The whole panel in a real browser over the real service (src/runtime.ts,
// its projects in memory): a person makes a new project and closes the
// window before it has a block, so no page ever tells the service it was
// left. A window opened after shows no projects, and the next new project,
// from home and from the editor's menu, is named as if none were ever made.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { createRuntime, type RuntimeDeps } from "../../src/runtime";
import { PANEL_ID } from "../../src/panel";
import { BUILTIN } from "../../src/lib/names";
import type { ProjectStorage } from "../../src/lib/projects";
import { memoryBlocks } from "@mileniumhq/paperapi";
import { service } from "./serviceStub";

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
function byText(selector: string, text: string): HTMLElement | undefined {
    const all = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => el.textContent?.trim().endsWith(text));
    return all.find((el) => !all.some((other) => other !== el && el.contains(other)));
}

const canvas = () => Blockly.Workspace.getAll().find((w): w is Blockly.WorkspaceSvg => w.rendered && !(w as Blockly.WorkspaceSvg).isFlyout && !!(w as Blockly.WorkspaceSvg).getFlyout());
/** The name on the open editor's menu bar, once its canvas takes edits. */
const editorName = () =>
    until("the editor", () => canvas() && !canvas()!.isReadOnly() && document.querySelector('[role="menubar"]')?.getAttribute("aria-label"));
const home = () => until("the home screen", () => !document.querySelector('[aria-label="All projects"]') && byText("button", "New project"));

/**
 * What the page shows now, at desktop width in both themes, when the harness
 * keeps screenshots; at a phone's width too with `phone`, which closes an open
 * editor (the panel shows its phone screen there).
 */
async function shoot(name: string, phone = false): Promise<void> {
    for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await frame();
        for (const [size, width, height] of [["desktop", 1280, 800], ...(phone ? ([["phone", 390, 844]] as const) : [])] as const) {
            const answer = await fetch("/screenshot", { method: "POST", body: JSON.stringify({ name: `${name}-${size}-${theme}`, width, height }) });
            if (!answer.ok) throw new Error(`the screenshot failed: ${await answer.text()}`);
        }
    }
    document.documentElement.removeAttribute("data-paperui-theme");
}

const mount = () =>
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <App />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );

async function run(): Promise<Record<string, unknown>> {
    const files = new Map<string, unknown>();
    const storage: ProjectStorage = {
        get: async (path) => structuredClone(files.get(path ?? "") ?? null),
        set: async (value, path) => void files.set(path ?? "", structuredClone(value)),
    };
    const nothing = async () => {
        throw new Error("the fixture's flows reach no panel");
    };
    const blocks = { run: nothing, read: nothing, property: nothing, onEvent: () => () => {}, onChange: () => () => {} } as unknown as RuntimeDeps["blocks"];
    const runtime = createRuntime({ storage, blocks, handle: memoryBlocks(PANEL_ID).panel });
    service.serve(runtime.calls);
    await runtime.init((patch) => service.announce(typeof patch === "function" ? patch(service.state()) : patch));

    // a new project, and the window closed on it before it had a block
    let dispose = mount();
    (await home()).click();
    const first = await editorName();
    dispose();

    // the next window
    dispose = mount();
    await home();
    const shown = document.querySelectorAll('[role="switch"]').length;
    const emptyState = Boolean(byText("*", "No projects yet"));
    await shoot("drafts-home", true);
    await home();
    byText("button", "New project")!.click();
    const fromHome = await editorName();
    // the editor's own New project, made while the one it leaves is still a draft
    const leaving = document.querySelector('[role="menubar"]')!;
    byText("button, [role=menuitem]", "Project")!.click();
    (await until("the Project menu's New project", () => byText("[role=menuitem]", "New project")))!.click();
    await until("the next editor", () => !leaving.isConnected);
    const fromMenu = await editorName();
    await shoot("drafts-editor");

    // a flow on its canvas, and home: the project's card shows it in miniature, each block in its own colour
    Blockly.serialization.blocks.append(
        { type: BUILTIN.onRun, x: 40, y: 40, inputs: { DO: { block: { type: BUILTIN.log, inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "hello" } } } } } } } },
        canvas()!,
    );
    const onCanvas = canvas()!
        .getAllBlocks(true)
        .map((block) => getComputedStyle(block.pathObject.svgPath).fill);
    document.querySelector<HTMLElement>('[aria-label="All projects"]')!.click();
    await home();
    const miniature = await until("the card's miniature", () => document.querySelector('svg[class*="_preview_"]')?.querySelectorAll("path").length && document.querySelector('svg[class*="_preview_"]'));
    const onCard = [...miniature.querySelectorAll("path")].map((path) => getComputedStyle(path).fill);
    await shoot("miniature-home");
    dispose();
    return { first, shown, emptyState, fromHome, fromMenu, onCanvas, onCard, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
