// One-shot pty destroy timers (T13). A temp pty used for kill/reset/world
// work must be destroyed ~1s later — but the timer itself must never keep
// the service process alive, and shutdown must be able to cancel timers
// that haven't fired. Every scheduleDestroy callback goes through here.
const pending = new Set<ReturnType<typeof setTimeout>>();

export function schedulePtyDestroy(
    id: string,
    destroy: (id: string) => void,
    tag: string,
): void {
    const timer = setTimeout(() => {
        pending.delete(timer);
        try {
            destroy(id);
        } catch (err) {
            console.error(`[${tag}] Failed to clean up pty:`, err);
        }
    }, 1000);
    // a pending cleanup never holds the service open (node + bun Timeouts)
    (timer as unknown as { unref?: () => void }).unref?.();
    pending.add(timer);
}

export function cancelPendingPtyDestroys(): void {
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
}

export function pendingPtyDestroyCount(): number {
    return pending.size;
}
