// Installed panels the registry doesn't list (dev links, direct installs)
// describe themselves: Paperboard reads their own manifest and store/
// files. Icons are fetched for the grid; the full listing only for the page
// being viewed. Entries live only while the panel stays installed, so the
// cache is bounded by the installed set.
import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { InstalledPanelMedia } from "@mileniumhq/paperapi/internal";
import type { LibraryBridge } from "./bridge";

export interface InstalledMedia {
    /** each panel's own listing; `full` once its page's read has landed */
    media: Accessor<Record<string, InstalledPanelMedia & { full: boolean }>>;
    /** why a panel's read failed, until a read of it succeeds */
    errors: Accessor<Record<string, string>>;
    /** reads still in flight */
    pending: Accessor<number>;
    retry: (id: string) => void;
}

// what is cached per installed panel goes with the panel; nothing changed
// keeps the same object, so nothing downstream is notified
function onlyInstalled<T>(entries: Record<string, T>, installed: Set<string>): Record<string, T> {
    const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => installed.has(id)));
    return Object.keys(kept).length === Object.keys(entries).length ? entries : kept;
}

/** Must be created inside a reactive owner: it reads as `unlisted` and `selected` change. */
export function createInstalledMedia(
    bridge: LibraryBridge,
    unlisted: Accessor<string[]>,
    selected: Accessor<string | null>,
): InstalledMedia {
    const [media, setMedia] = createSignal<Record<string, InstalledPanelMedia & { full: boolean }>>({});
    const [pending, setPending] = createSignal(0);
    const requested = new Set<string>();

    // a failed read is shown on the panel's page, never mistaken for a
    // panel with no listing; it stays until a read of it succeeds
    const [errors, setErrors] = createSignal<Record<string, string>>({});
    const dropError = (id: string) =>
        setErrors((prev) => {
            if (!(id in prev)) return prev;
            const { [id]: _, ...rest } = prev;
            return rest;
        });

    const request = (id: string, full: boolean) => {
        const key = `${id}:${full ? "full" : "icon"}`;
        if (requested.has(key)) return;
        requested.add(key);
        setPending((count) => count + 1);
        void bridge
            .media(id, full)
            .then(
                (answer) => {
                    if (!bridge.installed().some((panel) => panel.id === id)) return;
                    dropError(id);
                    setMedia((prev) => {
                        if (prev[id]?.full && !full) return prev;
                        return { ...prev, [id]: { ...answer, full } };
                    });
                },
                (err: Error) => {
                    // unavailable, not empty: a retry asks again
                    requested.delete(key);
                    console.error(`[library] ${id}'s own listing is unavailable:`, err);
                    setErrors((prev) => ({ ...prev, [id]: err.message }));
                },
            )
            .finally(() => setPending((count) => count - 1));
    };

    createEffect(
        on([() => bridge.mode(), unlisted, () => bridge.installed(), selected], ([mode, ids, installedList, open]) => {
            if (mode !== "embedded") return;
            const installed = new Set(installedList.map((panel) => panel.id));
            setMedia((prev) => onlyInstalled(prev, installed));
            setErrors((prev) => onlyInstalled(prev, installed));
            for (const key of [...requested]) {
                if (!installed.has(key.slice(0, key.lastIndexOf(":")))) requested.delete(key);
            }
            for (const id of ids) request(id, false);
            if (open && ids.includes(open)) request(open, true);
        }),
    );

    return {
        media,
        errors,
        pending,
        retry: (id) => {
            dropError(id);
            request(id, true);
        },
    };
}
