// What a place's browser keeps while another place is shown: the folder it's
// in, what's chosen, how it's sorted, and the uploads still going to it. The
// sidebar shows one place's Browser at a time and lets the rest go, so this
// lives with the place, above its Browser, until the place leaves Drive.
import { createSignal } from "solid-js";
import { showError, showToast, type PaperFileViewRef, type PaperFileViewSort } from "@mileniumhq/paperui";
import { drive } from "./client";
import { parentOf } from "./lib/contract";
import { createFiles } from "./lib/files";
import { createUploads } from "./lib/uploads";

export function createPlaceView(place: string) {
    const files = createFiles(drive.calls, place);
    const [folder, setFolder] = createSignal("");
    const [selection, setSelection] = createSignal<string[]>([]);
    const [sort, setSort] = createSignal<PaperFileViewSort>({ key: "name", dir: 1 });
    // the Browser showing this place now, if one is: an upload that lands lists its folder again there
    let shown: PaperFileViewRef | undefined;

    const uploads = createUploads(files, {
        landed: (entry) => void shown?.reload(parentOf(entry.path)),
        failed: (name, err) => showError(`Couldn't upload “${name}”`, err),
        finished: (landed) => {
            if (landed > 0) showToast({ title: landed === 1 ? "Uploaded 1 file" : `Uploaded ${landed} files`, icon: "cloud_done", variant: "success" });
        },
    });

    return {
        place,
        files,
        uploads,
        folder,
        setFolder,
        selection,
        setSelection,
        sort,
        setSort,
        /** A Browser shows this place: its view hears the uploads that land, until it's let go. */
        show(view: PaperFileViewRef): () => void {
            shown = view;
            return () => {
                if (shown === view) shown = undefined;
                // what it showed is read again when it's back: a hidden place holds no file in memory
                files.clear();
            };
        },
        /** The place left Drive: its uploads stop, and what it read is let go. */
        dispose() {
            uploads.cancel();
            shown = undefined;
            files.clear();
        },
    };
}

export type PlaceView = ReturnType<typeof createPlaceView>;
