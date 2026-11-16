// The whole panel in a real browser over the real service, which couldn't
// read its projects as it started (test/browserFixture.ts): Home says why
// in place of the list, never in a toast, and its Try again asks the service
// to read them again. Still unreadable, it stays and says why; readable, the
// projects show and it goes.
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

const toast = () => [...document.querySelectorAll<HTMLElement>("[data-paper-toasts] [role]")].find((el) => el.textContent?.includes("Couldn't read the projects"));
// Home's error, in place of the list
const failure = () => document.querySelector<HTMLElement>('[data-paper-error][role="region"][aria-label="Couldn\'t read the projects"]');
/** what the error says under its title: why */
const reason = () => failure()?.querySelector("[data-paper-error] > div > :nth-child(2)")?.textContent ?? "";
const tryAgain = () => [...(failure()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.trim() === "Try again");

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
    const said = (await until("Home's error with Try again", () => tryAgain() && failure())).textContent ?? "";
    const offered = Boolean(tryAgain());
    const why = reason();
    const toasted = Boolean(toast());
    await shoot("unreadable-home");

    // still unreadable: the read again is refused, and the error stays with why, Try again ready once more
    (await until("Try again", tryAgain)).click();
    await until("Try again to wait on its read", () => tryAgain()?.disabled);
    const again = (await until("the error still saying why", () => tryAgain() && !tryAgain()!.disabled && failure())).textContent ?? "";
    const toastedAgain = Boolean(toast());
    const whyAgain = reason();

    // readable now: the projects show, and the error goes
    await ask("projects", { do: "mend" });
    (await until("Try again", () => tryAgain() && !tryAgain()!.disabled && tryAgain())).click();
    await until("the empty projects list", () => byText("*", "No projects yet"));
    const gone = !failure();
    const canMake = !(byText("button", "New project") as HTMLButtonElement | undefined)?.disabled;
    return { said, why, offered, toasted, again, whyAgain, toastedAgain, gone, canMake, uncaught: [...errors] };
}

run()
    .then(
        (checks) => ({ checks, error: "" }),
        (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
    )
    .then((results) => fetch("/result", { method: "POST", body: JSON.stringify(results) }));
