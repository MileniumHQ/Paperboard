// What a test process started and must not leave behind (a test daemon) is
// undone when the process is stopped by a timeout or Ctrl-C, or a script
// exits without undoing it. bun test emits no exit event, so a suite still
// stops its own in afterAll; this catches the paths it can't. (Chrome needs
// more, a process that outlives this one: chrome.ts has its own reaper.)
const pending = new Set<() => void>();
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let hooked = false;

function undoAll(): void {
    for (const undo of [...pending]) {
        pending.delete(undo);
        try {
            undo();
        } catch (err) {
            // quiet: an exit handler: the other undos must still run, and stderr is where the test run reports
            console.error("Cleaning up after the test process failed:", err);
        }
    }
}

function hook(): void {
    if (hooked) return;
    hooked = true;
    process.on("exit", undoAll);
    for (const signal of SIGNALS) {
        process.once(signal, () => {
            undoAll();
            // the signal then does what it would have done without this
            process.kill(process.pid, signal);
        });
    }
}

/** runs `undo` (synchronously) when the process ends, unless the returned function is called first */
export function undoOnExit(undo: () => void): () => void {
    hook();
    pending.add(undo);
    return () => pending.delete(undo);
}
