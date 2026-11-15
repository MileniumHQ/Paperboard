// Stopping a daemon-supervised child, the one way every part of the service does it.

/** the daemon gives the whole service 3 s to stop */
const STOP_GRACE_MS = 2_000;

export interface ChildHost {
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

/**
 * Ask the child to stop (SIGTERM), make it past the grace (SIGKILL), and return once the daemon says it's gone.
 * One that's not running is already stopped; one still running after both throws.
 */
export async function stopChild(host: ChildHost, id: string): Promise<void> {
    let exited!: () => void;
    const gone = new Promise<void>((ok) => (exited = ok));
    const off = host.onExit(id, () => exited());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        for (const signal of ["SIGTERM", "SIGKILL"]) {
            if (!(await host.exists(id))) return;
            // one that ended between the look and the signal is stopped all the same
            await host.kill(id, signal).catch(async (e) => {
                if (await host.exists(id)) throw e;
            });
            await Promise.race([gone, new Promise<void>((ok) => (timer = setTimeout(ok, STOP_GRACE_MS)))]);
            clearTimeout(timer);
        }
        if (await host.exists(id)) throw new Error(`${id} didn't stop`);
    } finally {
        clearTimeout(timer);
        off();
    }
}
