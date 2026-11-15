// What the panel's browser fixtures share (browserFixture.ts): what the page
// threw, a wait on the page, and the result posted back to the test as JSON.
/** what the page threw and didn't catch; as PaperUI's error toast, not the browser's own notes (a ResizeObserver that ran over), which carry no error */
export const errors: string[] = [];
window.addEventListener("error", (event) => event.error != null && errors.push(event.error instanceof Error ? event.error.message : String(event.error)));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function until<T>(what: string, look: () => T | null | undefined | false): Promise<T> {
    const deadline = performance.now() + 15_000;
    for (;;) {
        const found = look();
        if (found) return found;
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await frame();
    }
}

/** Runs the fixture and posts what it found (or why it couldn't) to the test. */
export function report(run: () => Promise<Record<string, unknown>>): void {
    run()
        .then(
            (checks) => ({ checks, error: "" }),
            (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
        )
        .then((result) => fetch("/result", { method: "POST", body: JSON.stringify(result) }));
}
