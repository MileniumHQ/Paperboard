// The editor's Load backup window in a real browser, over the real service
// and a daemon that keeps Blocks' backups on this computer
// (test/browserFixture.ts). The daemon refuses the list once: the window
// says why in place, never in a toast that goes while the list stays
// unread, and its Try again lists them.
import { render } from "solid-js/web";
import * as Blockly from "blockly";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { refuseAction } from "./wire";
import { SERVICED } from "./world";

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
function byText(selector: string, text: string, root: ParentNode = document): HTMLElement | undefined {
    const all = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.textContent?.trim().endsWith(text));
    return all.find((el) => !all.some((other) => other !== el && el.contains(other)));
}

const canvas = () => Blockly.Workspace.getAll().find((w): w is Blockly.WorkspaceSvg => w.rendered && !(w as Blockly.WorkspaceSvg).isFlyout && !!(w as Blockly.WorkspaceSvg).getFlyout());
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
// the window's error, in place of the list
const failure = () => dialog()?.querySelector<HTMLElement>('[data-paper-error][role="region"][aria-label="Couldn\'t list the backups"]') ?? null;
const tryAgain = () => (failure() ? byText("button", "Try again", failure()!) : undefined);
const toast = () => [...document.querySelectorAll<HTMLElement>("[data-paper-toasts] [role]")].find((el) => el.textContent?.includes("Couldn't list the backups"));

/** What the page shows now, at desktop and small width in both themes, when the harness keeps screenshots (a phone's width shows no editor). */
async function shoot(name: string): Promise<void> {
    for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await frame();
        for (const [size, width, height] of [["desktop", 1280, 800], ["small", 860, 560]] as const) {
            const answer = await fetch("/screenshot", { method: "POST", body: JSON.stringify({ name: `${name}-${size}-${theme}`, width, height }) });
            if (!answer.ok) throw new Error(`the screenshot failed: ${await answer.text()}`);
        }
    }
    document.documentElement.removeAttribute("data-paperui-theme");
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
    (await until("the project's card", () => byText("*", SERVICED.name))).click();
    await until("the editor", () => canvas() && !canvas()!.isReadOnly() && document.querySelector('[role="menubar"]'));

    // the daemon refuses the list as the window opens
    refuseAction("backup:list", true);
    (await until("the Backup menu", () => byText("button, [role=menuitem]", "Backup"))).click();
    (await until("Load backup", () => byText("[role=menuitem]", "Load backup"))).click();
    const said = (await until("the window's error with Try again", () => tryAgain() && failure())).textContent ?? "";
    const toasted = Boolean(toast());
    // its one Try again is the error's: the window keeps its close, Cancel and Load backup
    const footerButtons = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !failure()!.contains(b)).map((b) => b.textContent?.trim());
    const loadHeld = (byText("button", "Load backup", dialog()!) as HTMLButtonElement | undefined)?.disabled ?? null;
    await shoot("backups-unlisted");

    // the daemon answers again: Try again lists them, and the error goes
    refuseAction("backup:list", false);
    (await until("the error's Try again", tryAgain)).click();
    await until("the list read again", () => byText("*", "No backups here yet. Make one with Backup, then Create backup.", dialog() ?? document));
    const gone = !failure();
    return { said, toasted, footerButtons, loadHeld, gone, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
