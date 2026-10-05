/** One in-flight count read; teardown also ignores a late daemon response. */
export function pollTrayCount(deps: {
    read: () => Promise<number>;
    render: (count: number | null) => void;
    onError: (error: unknown) => void;
}, intervalMs = 10_000): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
        let count: number | null = null;
        try { count = await deps.read(); }
        catch (error) { deps.onError(error); }
        if (stopped) return;
        deps.render(count);
        timer = setTimeout(() => void refresh(), intervalMs);
        timer.unref?.();
    };
    void refresh();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
