import styles from "./viewers.module.css";
import { Failure } from "./Failure";
import { createEffect, createSignal, createUniqueId, For, Match, on, onCleanup, Switch } from "solid-js";
import { PaperLoader } from "../../../components/PaperLoader";
import { errorMessage } from "../../../utils/errorMessage";

const SIZES = [1, 3, 5, 8, 11] as const;

/** Loads a font file under a family name of its own, and lets it go again when the preview does. */
export async function loadPreviewFont(src: string, family: string, signal: AbortSignal): Promise<FontFace> {
    const response = await fetch(src, { signal });
    if (!response.ok) throw new Error(`couldn't be read (${response.status})`);
    const face = new FontFace(family, await response.arrayBuffer());
    try {
        await face.load();
    } catch {
        // quiet: the message the browser gives ("A network error occurred") would mislead; the cause is the file
        throw new Error("isn't a font this browser can read");
    }
    signal.throwIfAborted();
    return face;
}

/** A font set in a large sample, its alphabet, and a sentence at a ladder of sizes. */
export function FontView(props: { src: string; name: string; onError: (message: string) => void }) {
    const family = `paper-preview-${createUniqueId()}`;
    const [face, setFace] = createSignal<FontFace | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(
        on(
            () => props.src,
            (src) => {
                const controller = new AbortController();
                setFace(null);
                setError(null);
                let loaded: FontFace | null = null;
                loadPreviewFont(src, family, controller.signal).then(
                    (f) => {
                        if (controller.signal.aborted) return;
                        loaded = f;
                        document.fonts.add(f);
                        setFace(f);
                    },
                    (err: unknown) => {
                        if (controller.signal.aborted) return;
                        const message = `${props.name} ${errorMessage(err)}`;
                        setError(message);
                        props.onError(message);
                    },
                );
                onCleanup(() => {
                    controller.abort();
                    if (loaded) document.fonts.delete(loaded);
                });
            },
        ),
    );
    return (
        <Switch>
            <Match when={error()}>
                <Failure title={error()!} />
            </Match>
            <Match when={!face()}>
                <PaperLoader class={styles.centered} loaderStatus="indeterminate" delay={150} label={`Loading ${props.name}`} />
            </Match>
            <Match when={true}>
                <div class={`${styles.sheet} ${styles.font}`} style={{ "font-family": `"${family}"` }}>
                    <div class={styles.fontHero}>Aa</div>
                    <div class={styles.fontAlphabet}>
                        ABCDEFGHIJKLMNOPQRSTUVWXYZ
                        <br />
                        abcdefghijklmnopqrstuvwxyz
                        <br />
                        0123456789 &amp;?!@#%
                    </div>
                    <For each={SIZES}>
                        {(size) => (
                            <p class={styles.fontSample} style={{ "font-size": `var(--paper-text-size-${size})` }}>
                                The quick brown fox jumps over the lazy dog.
                            </p>
                        )}
                    </For>
                </div>
            </Match>
        </Switch>
    );
}
