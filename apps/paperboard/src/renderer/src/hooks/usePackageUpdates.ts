import { createSignal, onMount, onCleanup } from "solid-js";
import type { PackageUpdatesState } from "../../../shared/packageUpdates";
import { isBrowserShell, shellIpc } from "../lib/shell";

// while updates wait, look again now and then: the daemon installs each one
// as soon as the panels holding it back stop, and the notice should go too
const REFRESH_MS = 30_000;

export function usePackageUpdates() {
    const [state, setState] = createSignal<PackageUpdatesState>({ notices: [], failures: [] });
    const [open, setOpen] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let announced = false;
    const refresh = async () => {
        if (isBrowserShell() || disposed) return;
        clearTimeout(timer);
        timer = undefined;
        try {
            const next = await shellIpc().invoke<PackageUpdatesState>("package-updates");
            if (disposed) return;
            setError(null);
            setState(next);
            // shown once on launch; afterwards the top bar button reopens it
            if (next.notices.length > 0 && !announced) {
                announced = true;
                setOpen(true);
            }
        } catch (err) {
            if (disposed) return;
            setError(`Could not check for waiting package updates: ${String(err)}`);
        }
        if (!disposed && (state().notices.length > 0 || error())) timer = setTimeout(() => void refresh(), REFRESH_MS);
    };
    onMount(() => {
        if (isBrowserShell()) return;
        const ipc = shellIpc();
        const handler = () => void refresh();
        ipc.on("package-updates-changed", handler);
        onCleanup(() => {
            disposed = true;
            clearTimeout(timer);
            ipc.removeListener("package-updates-changed", handler);
        });
        void refresh();
    });
    return { state, open, setOpen, error, refresh };
}
