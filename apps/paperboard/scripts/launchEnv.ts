// Environment preparation for the Electron dev launcher.
//
// Electron decides "run as a plain Node process" from ELECTRON_RUN_AS_NODE
// before any application code executes. Editors and terminals that are
// themselves Electron apps (VS Code, T3 Code) export it into every child
// shell, which turns `electron-vite dev` into `node out/main/index.js` and
// crashes the app at import time with no window and no log line. The launcher
// is the only place that can strip it.

export function electronChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const next = { ...env };
    delete next.ELECTRON_RUN_AS_NODE;
    return next;
}

// Paperboard's own launch flags are Electron's to read, but electron-vite
// rejects any option it doesn't know ("Unknown option `--mobile`") unless it
// comes after `--`. The launcher moves them there, so `bun run dev --mobile`
// works as well as `bun run dev -- --mobile`.
const APP_FLAGS = ["--mobile", "--no-tutorial", "--browser", "--devtools"];
const APP_FLAG_PREFIXES = ["--browser-port="];

function isAppFlag(arg: string): boolean {
    return APP_FLAGS.includes(arg) || APP_FLAG_PREFIXES.some((prefix) => arg.startsWith(prefix));
}

export function electronViteArgs(args: readonly string[]): string[] {
    const split = args.indexOf("--");
    const before = split === -1 ? [...args] : args.slice(0, split);
    const after = split === -1 ? [] : args.slice(split + 1);
    const moved = before.filter(isAppFlag);
    if (moved.length === 0) return [...args];
    return [...before.filter((arg) => !isAppFlag(arg)), "--", ...moved, ...after];
}
