import { isWindowsTarget } from "../lib/platform";

// Recoverable deletion, one implementation for every destructive path in
// this panel (worlds, world reset, plugins, player data). The daemon's
// discipline — rename to trash before delete — applied through a pty:
//
//   posix: mkdir -p .trash-<ts> && (move each existing path) && rm -rf .trash-<ts>
//   win:   mkdir .trash-<ts> && (move each existing path) && rmdir /s /q .trash-<ts>
//
// Each path is moved only if it exists: a world may not have a
// `_nether`/`_the_end` directory until those dimensions are entered, and a
// missing sibling must not abort the whole chain (which left the trash dir
// staged and the delete reported as failed). A path that EXISTS but fails
// to move still aborts before the remove, so the trash dir remains the
// recovery point.
//
// A crash between the move and the remove leaves a clearly-marked trash
// dir instead of a half-deleted live tree. Every path is pre-validated by
// the caller (world/plugin/uuid patterns); quoting is single-quote on
// posix (only ' is unsafe there, and the patterns exclude it) and
// double-quote on Windows (only " and % are unsafe there, excluded too).
// Quoting is never escaping: an excluded character is a refusal upstream.
//
// Completion is VERIFIED, not assumed: the pty is awaited to exit, and the
// command prints a success marker only if the full chain ran. A false
// "removed" claim here would be read by the UI as a completed delete.
//
// Echo discipline: the shell's line discipline echoes the TYPED command
// back, so the marker must be typed in a form whose echo differs from its
// OUTPUT — posix single-quote fragments ('OK' prints as OK) and a caret
// escape on cmd.exe (O^K prints as OK). Otherwise `output.includes(OK)`
// matches the echo of the command itself and the marker is decoration.

export const TRASH_REMOVE_OK = "TRASH_REMOVE_OK";
export const TRASH_REMOVE_DONE = "TRASH_REMOVE_DONE";

export interface TrashRemoveDeps {
    getServerDir: () => Promise<string>;
    getTargetOs: () => Promise<string>;
    createPty: (id: string, opts: { cwd: string; cols: number; rows: number }) => unknown;
    writePty: (id: string, data: string) => void;
    onPtyData: (id: string, cb: (chunk: string) => void) => () => void;
    onPtyExit: (id: string, cb: (code?: number) => void) => () => void;
    scheduleDestroy: (id: string) => void;
    /** completion cap for the remove; the staged trash dir is the recovery point on timeout */
    completionTimeoutMs?: number;
}

export const TRASH_REMOVE_TIMEOUT_MS = 120_000;

// verified short-lived pty execution, shared by every command this panel
// runs through a temp shell: subscribe before writing (completion can
// never race the write), await the exit, optionally require a success
// marker, and destroy the pty on every path out.
export async function runPtyCommandWith(
    deps: Pick<
        TrashRemoveDeps,
        "writePty" | "onPtyData" | "onPtyExit" | "scheduleDestroy" | "completionTimeoutMs"
    >,
    ptyId: string,
    cmd: string,
    successMarker?: string,
): Promise<void> {
    let output = "";
    let detached = false;
    let detach: () => void = () => {};
    let completionResolve!: () => void;
    const completion = new Promise<void>((resolve) => {
        completionResolve = resolve;
    });
    const offData = deps.onPtyData(ptyId, (chunk) => {
        output += chunk;
    });
    const offExit = deps.onPtyExit(ptyId, () => completionResolve());
    detach = () => {
        if (detached) return;
        detached = true;
        offExit();
        offData();
    };
    try {
        deps.writePty(ptyId, `${cmd}\nexit\n`);
        let timerReject!: (err: Error) => void;
        const timerDone = new Promise<never>((_, reject) => {
            timerReject = reject;
        });
        const timer = setTimeout(
            () =>
                timerReject(
                    new Error(
                        `pty "${ptyId}" did not complete in ${deps.completionTimeoutMs ?? TRASH_REMOVE_TIMEOUT_MS}ms; its work may be unfinished`,
                    ),
                ),
            deps.completionTimeoutMs ?? TRASH_REMOVE_TIMEOUT_MS,
        );
        try {
            await Promise.race([completion, timerDone]);
            if (successMarker !== undefined && !output.includes(successMarker)) {
                throw new Error(
                    `pty "${ptyId}" exited without the "${successMarker}" marker; the command failed partway`,
                );
            }
        } finally {
            // the completion timer must never outlive this call
            clearTimeout(timer);
        }
    } finally {
        detach();
        deps.scheduleDestroy(ptyId);
    }
}

export function trashDirName(stamp: number = Date.now()): string {
    return `.trash-${stamp}`;
}

export function buildTrashRemoveCommand(
    paths: string[],
    trashDir: string,
    isWin: boolean,
): string {
    if (paths.length === 0) {
        throw new Error("Refusing to run a trash-remove with no paths");
    }
    if (isWin) {
        // each path is moved only when present; a missing sibling is
        // skipped, a present-but-unmovable path still breaks the chain
        // before the remove. `&` separates unconditionally: DONE is printed
        // even when an earlier link fails; OK only prints after the whole
        // chain. The ^ escapes keep the echoed command line from containing
        // the bare markers, so a failed chain's echo cannot fake success.
        const q = (p: string) => `"${p}"`;
        const moves = paths
            .map((p) => `if exist ${q(p)} move ${q(p)} ${q(trashDir)}`)
            .join(" && ");
        return `mkdir ${q(trashDir)} && ${moves} && rmdir /s /q ${q(trashDir)} && echo TRASH_REMOVE_O^K & echo TRASH_REMOVE_D^ONE`;
    }
    // "; echo DONE" separates unconditionally. The 'ok'/'done' fragments
    // drop their quotes in OUTPUT but stay in the echoed typed line.
    const q = (p: string) => `'${p}'`;
    const moves = paths
        .map((p) => `( [ ! -e ${q(p)} ] || mv ${q(p)} ${q(trashDir)} )`)
        .join(" && ");
    return `mkdir -p ${q(trashDir)} && ${moves} && rm -rf ${q(trashDir)} && echo TRASH_REMOVE_'OK' ; echo TRASH_REMOVE_'DONE'`;
}

export async function trashRemovePathsWith(
    deps: TrashRemoveDeps,
    paths: string[],
    ptyId: string,
    trashDir: string = trashDirName(),
): Promise<void> {
    const serverDir = await deps.getServerDir();
    const targetOs = await deps.getTargetOs();
    const cmd = buildTrashRemoveCommand(paths, trashDir, isWindowsTarget(serverDir, targetOs));
    await deps.createPty(ptyId, { cwd: serverDir, cols: 80, rows: 24 });
    try {
        await runPtyCommandWith(deps, ptyId, cmd, TRASH_REMOVE_OK);
    } catch (err) {
        // a partial failure is recoverable, not silent: the staged trash
        // dir is the recovery point; the DONE marker is cosmetic output
        // for a human reading the console, the OK marker is the gate
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes(`remains on disk`)) throw err;
        throw new Error(
            `${message}; staged trash dir "${trashDir}" remains on disk for manual recovery`,
        );
    }
}
