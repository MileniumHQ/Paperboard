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
