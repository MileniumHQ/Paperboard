// Instance mode decisions, kept out of index.ts so they can be tested
// without Electron. A launch is either an explicit browser request, a
// request to surface the existing app, or a request to open its first
// window. Browser mode is never sticky: a plain launch always gets the
// desktop app, even when the lock holder is serving a browser session.

export type SecondLaunchAction = "browser" | "focus" | "window";

export function secondLaunchAction(argv: readonly string[], hasWindow: boolean): SecondLaunchAction {
    if (argv.includes("--browser")) return "browser";
    return hasWindow ? "focus" : "window";
}

// A browser-mode process is the only windowless process allowed to outlive
// its windows. A host started from a second `--browser` launch while the
// desktop app was running must not turn that app into a zombie after its
// window closes.
export function keepAliveWithoutWindows(platform: NodeJS.Platform, browserMode: boolean): boolean {
    return platform === "darwin" || browserMode;
}
