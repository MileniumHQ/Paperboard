// Terminals as the daemon runs them, in this test process: a real
// pseudo-terminal (Bun.spawn's terminal) running a real shell, started with
// the daemon's own shell integration (apps/daemon/src/workloads/
// shellIntegration.ts), so its prompts and commands are marked exactly as in
// the app. Its environment is only what the test gives it: no rc file of the
// machine running the tests is read. The program in front isn't followed
// (the daemon reads that from the system), so onForeground never fires.
//
// The daemon's file is loaded by a path the typechecker does not follow: it
// is another target's source, typechecked by its own gate step.

import path from "node:path";
import type { Terminals } from "../../src/service/userShells";

const INTEGRATION: string = path.resolve(import.meta.dir, "../../../../apps/daemon/src/workloads/shellIntegration.ts");
type ShellLaunch = (shell: string, env: Record<string, string | undefined>) => { args: string[]; env: Record<string, string> };

interface Running {
    proc: Bun.Subprocess;
    exited: boolean;
}

export async function ptyTerminals(o: { shell: string; env: Record<string, string> }): Promise<Terminals & { running(): string[] }> {
    const { shellLaunch } = (await import(INTEGRATION)) as { shellLaunch: ShellLaunch };
    const live = new Map<string, Running>();
    const data = new Map<string, Set<(d: string) => void>>();
    const exits = new Map<string, Set<(code?: number) => void>>();
    const listen = <T>(map: Map<string, Set<T>>, id: string, cb: T) => {
        const set = map.get(id) ?? map.set(id, new Set()).get(id)!;
        set.add(cb);
        return () => void set.delete(cb);
    };
    return {
        async create(id, c) {
            if (live.has(id)) throw new Error(`terminal ${id} is already running`);
            const launch = shellLaunch(o.shell, o.env);
            const decoder = new TextDecoder();
            const proc = Bun.spawn([o.shell, ...launch.args], {
                cwd: c.cwd,
                env: { ...o.env, ...launch.env, ...c.env, TERM: "xterm-256color" },
                terminal: {
                    cols: c.cols,
                    rows: c.rows,
                    data: (_t, bytes) => {
                        const text = decoder.decode(bytes, { stream: true });
                        for (const cb of data.get(id) ?? []) cb(text);
                    },
                },
            });
            const r: Running = { proc, exited: false };
            live.set(id, r);
            void proc.exited.then((code) => {
                r.exited = true;
                if (live.get(id) === r) live.delete(id);
                for (const cb of exits.get(id) ?? []) cb(code);
            });
        },
        async write(id, text) {
            const r = live.get(id);
            if (!r) throw new Error(`Terminal "${id}" is not running`);
            r.proc.terminal!.write(text);
        },
        async destroy(id) {
            const r = live.get(id);
            if (!r) return;
            live.delete(id);
            r.proc.kill("SIGKILL");
            await r.proc.exited;
        },
        async exists(id) {
            return live.has(id);
        },
        onData: (id, cb) => listen(data, id, cb),
        onForeground: () => () => undefined,
        onExit: (id, cb) => listen(exits, id, cb),
        running: () => [...live.keys()],
    };
}
