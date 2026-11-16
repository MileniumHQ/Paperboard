// The whole panel in a real browser over the real service, which couldn't
// read its projects as it started (test/browserFixture.ts): Home says it
// couldn't load, the toast says why, and Try again asks the service to read
// them again. Still unreadable, the toast comes back; readable, the projects
// show and the toast goes.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { ask } from "./wire";

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

const toast = () => [...document.querySelectorAll<HTMLElement>('[data-paper-toasts] [role="alert"]')].find((el) => el.textContent?.includes("Couldn't read the projects"));
const tryAgain = () => byText("button", "Try again");

/** What the page shows now, at desktop and phone width in both themes, when the harness keeps screenshots. */
async function shoot(name: string): Promise<void> {
    for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-paperui-theme", theme);
        await frame();
        for (const [size, width, height] of [["desktop", 1280, 800], ["small", 860, 560], ["phone", 390, 844]] as const) {
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
    await until("Home's Couldn't load", () => byText("*", "Couldn't load"));
    const said = (await until("the toast saying why", toast)).textContent ?? "";
    const offered = Boolean(tryAgain());
    await shoot("unreadable-home");

    // still unreadable: the toast goes while it reads, and comes back
    (await until("the toast's Close", () => toast()?.querySelector<HTMLElement>('button[aria-label="Close"]'))).click();
    await until("the toast to close", () => !toast());
    (await until("Try again", tryAgain)).click();
    const again = (await until("the toast back with why", toast)).textContent ?? "";

    // readable now: the projects show, and the toast goes
    await ask("projects", { do: "mend" });
    (await until("Try again", () => tryAgain() && !(tryAgain() as HTMLButtonElement).disabled && tryAgain())).click();
    await until("the empty projects list", () => byText("*", "No projects yet"));
    await until("the toast to go", () => !toast());
    const canMake = !(byText("button", "New project") as HTMLButtonElement | undefined)?.disabled;
    return { said, offered, again, canMake, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
