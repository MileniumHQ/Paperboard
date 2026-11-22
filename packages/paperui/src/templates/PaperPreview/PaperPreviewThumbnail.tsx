import styles from "./PaperPreviewThumbnail.module.css";
import { createEffect, createSignal, on, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { PaperIcon } from "../../components/PaperIcon";
import { cx } from "../../utils/cx";
import { errorMessage } from "../../utils/errorMessage";
import { previewIcon, previewKind, type PaperPreviewKind } from "./kinds";
import { paperPreviewThumbnail } from "./thumbnail";

export interface PaperPreviewThumbnailProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    /** The file's address. Until it's set, the thumbnail shows the file's symbol. */
    src?: string;
    name: string;
    type?: string;
    /** How the file previews, when its type and name don't say; null shows only its symbol. */
    kind?: PaperPreviewKind | null;
    /** "cover" fills the box and crops, as a photo grid does; "contain" shows all of it. */
    fit?: "contain" | "cover";
    /** Called when the file can't be drawn; the thumbnail shows the file's symbol instead. */
    onError?: (message: string) => void;
}

// thumbnails are made at one of these sizes, so boxes of nearly one size share them
const SIZES = [64, 128, 256, 512, 1024];

/**
 * A small picture of a file that fills its box: made only once it's near the
 * screen, at the box's size on this display, and shared with every other
 * thumbnail of the same file. Until it's ready, and for files with no
 * picture, it shows the symbol of the file's kind.
 */
export function PaperPreviewThumbnail(props: PaperPreviewThumbnailProps) {
    const [local, rest] = splitProps(props, ["src", "name", "type", "kind", "fit", "onError", "class"]);
    let box!: HTMLDivElement;
    const kind = () => (local.kind !== undefined ? local.kind : previewKind(local.name, local.type));
    const [near, setNear] = createSignal(false);
    const [size, setSize] = createSignal(0);
    const [url, setUrl] = createSignal<string | null>(null);
    const [failed, setFailed] = createSignal<string | null>(null);

    onMount(() => {
        const seen = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: "50%" });
        const sized = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            const wanted = Math.max(width, height) * (window.devicePixelRatio || 1);
            const bucket = SIZES.find((s) => s >= wanted) ?? SIZES[SIZES.length - 1];
            // a box that shrinks keeps its sharper picture; one that grows asks for a bigger one
            setSize((current) => Math.max(current, bucket));
        });
        seen.observe(box);
        sized.observe(box);
        onCleanup(() => {
            seen.disconnect();
            sized.disconnect();
        });
    });

    createEffect(
        on(
            () => [near(), size(), local.src, kind()] as const,
            ([isNear, px, src, k]) => {
                setFailed(null);
                if (!isNear || !px || !src || !k) return;
                const controller = new AbortController();
                let made: string | null = null;
                paperPreviewThumbnail({ src, name: local.name, type: local.type, kind: k }, { size: px, signal: controller.signal }).then(
                    (blob) => {
                        if (controller.signal.aborted) return;
                        made = blob ? URL.createObjectURL(blob) : null;
                        setUrl(made);
                    },
                    (err: unknown) => {
                        if (controller.signal.aborted) return;
                        const message = `${local.name} ${errorMessage(err)}`;
                        setUrl(null);
                        setFailed(message);
                        local.onError?.(message);
                    },
                );
                onCleanup(() => {
                    controller.abort();
                    // the picture shown stays until the next one replaces it
                    if (made) queueMicrotask(() => made && URL.revokeObjectURL(made));
                });
            },
        ),
    );
    // a file with no picture, or none yet, shows no stale one
    createEffect(on([() => local.src, kind], () => setUrl(null), { defer: true }));

    return (
        <div
            ref={box}
            {...rest}
            class={cx(styles.PaperPreviewThumbnail, local.class)}
            classList={{ [styles.cover]: local.fit === "cover" }}
            title={failed() ?? undefined}
        >
            <Show
                when={url()}
                fallback={
                    <PaperIcon class={styles.symbol} aria-hidden="true">
                        {failed() ? "broken_image" : previewIcon(kind())}
                    </PaperIcon>
                }
            >
                <img class={styles.picture} src={url()!} alt={local.name} draggable={false} />
            </Show>
        </div>
    );
}
