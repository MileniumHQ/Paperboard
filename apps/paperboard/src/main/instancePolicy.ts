// Instance mode decisions, kept out of index.ts so they can be tested
// without Electron. A launch is either a browser request (`--web` opens
// the default browser, `--browser` prints a sign-in link for development),
// a request to surface the existing app, or a request to open its first
// window. Browser mode is never sticky: a plain launch always gets the
// desktop app, even when the lock holder is serving a browser session.

export type SecondLaunchAction = "web" | "browser" | "focus" | "window";

export function secondLaunchAction(argv: readonly string[], hasWindow: boolean): SecondLaunchAction {
    if (argv.includes("--web")) return "web";
    if (argv.includes("--browser")) return "browser";
    return hasWindow ? "focus" : "window";
}
