import styles from "./index.module.css";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { errorMessage } from "../../utils/errorMessage";
import { getVarCss } from "../../utils/theme";
import { paperFileViewExtension, paperFileViewKind } from "./files";
import type { PaperFileViewEntry, PaperFileViewThumbnailOptions } from "./types";

/** Folders whose names say what they hold wear a small symbol of it, as a Mac's Pictures folder does. */
const FOLDER_BADGES: Record<string, string> = {
    photos: "photo_camera",
    pictures: "photo_camera",
    music: "music_note",
    movies: "movie",
    videos: "movie",
    downloads: "download",
    documents: "description",
    projects: "code",
};

// thumbnails are asked for at one of these sizes, so nearby sizes share them
const SIZES = [64, 128, 256, 512];

/** Watches entries for nearing the screen, one observer for the whole view. */
export type NearScreen = (el: Element, near: () => void) => () => void;

export interface GlyphProps {
    entry: PaperFileViewEntry;
    /** the glyph's edge in px; under 40 it drops a sheet's details */
    size: number;
    thumbnail?: (entry: PaperFileViewEntry, options: PaperFileViewThumbnailOptions) => Promise<Blob | null>;
    near: NearScreen;
}

/**
 * A file the way people know it on sight: a folder, a small picture of the
 * file once the host has made one, or a sheet of paper in its kind's colour
 * with its extension on it.
 */
export function Glyph(props: GlyphProps) {
    let box!: HTMLSpanElement;
    const kind = () => paperFileViewKind(props.entry);
    const small = () => props.size < 40;
    const [isNear, setNear] = createSignal(false);
    const [picture, setPicture] = createSignal<string | null>(null);
    const [failed, setFailed] = createSignal<string | null>(null);

    onMount(() => onCleanup(props.near(box, () => setNear(true))));

    const wanted = () => {
        const px = props.size * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
        return SIZES.find((s) => s >= px) ?? SIZES[SIZES.length - 1];
    };

    createEffect(
        on(
            () => [isNear(), props.thumbnail, props.entry.kind, props.entry.path, props.entry.modified, props.entry.size, wanted(), props.size] as const,
            ([near, thumbnail, entryKind, , , , size]) => {
                setFailed(null);
                if (!near || !thumbnail || entryKind !== "file") return setPicture(null);
                const controller = new AbortController();
                let made: string | null = null;
                thumbnail(props.entry, { size, edge: props.size, signal: controller.signal }).then(
                    (blob) => {
                        if (controller.signal.aborted) return;
                        made = blob ? URL.createObjectURL(blob) : null;
                        setPicture(made);
                    },
                    (err: unknown) => {
                        if (controller.signal.aborted) return;
                        // quiet: shown on the entry, as its symbol with the reason on hover
                        setPicture(null);
                        setFailed(errorMessage(err));
                    },
                );
                onCleanup(() => {
                    controller.abort();
                    // the picture shown stays until the next replaces it; a drawn image outlives its URL
                    if (made) URL.revokeObjectURL(made);
                });
            },
        ),
    );

    return (
        <span
            ref={box}
            class={styles.glyph}
            classList={{ [styles.small]: small() }}
            style={{ "--glyph-size": `${props.size}px`, "--glyph-tone": getVarCss(kind().tone) }}
            title={failed() ? `Couldn't draw a picture of ${props.entry.name}: ${failed()}` : undefined}
            aria-hidden="true"
        >
            <Show
                when={props.entry.kind === "folder"}
                fallback={
                    <Show
                        when={picture()}
                        fallback={
                            <span class={styles.sheet}>
                                <PaperIcon class={styles.sheetIcon}>{failed() ? "broken_image" : kind().icon}</PaperIcon>
                                <Show when={paperFileViewExtension(props.entry.name)}>
                                    {(ext) => <span class={styles.sheetExt}>{ext()}</span>}
                                </Show>
                            </span>
                        }
                    >
                        {(src) => <img class={styles.picture} src={src()} alt="" draggable={false} />}
                    </Show>
                }
            >
                <PaperIcon class={styles.folder}>folder</PaperIcon>
                <Show when={!small() && FOLDER_BADGES[props.entry.name.toLowerCase()]}>
                    {(badge) => <PaperIcon class={styles.folderBadge}>{badge()}</PaperIcon>}
                </Show>
            </Show>
        </span>
    );
}
