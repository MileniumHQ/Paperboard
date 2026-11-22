// PaperModel's live part, loaded the first time a model is shown: three.js
// comes with it. It owns the viewer (one WebGL context) and the model on it,
// and tells PaperModel's shell when it is loading, ready or failed; the
// shell shows the loader and the failure.
import styles from "./index.module.css";
import { batch, createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperPreviewControls } from "../../templates/PaperPreview/controls";
import { createLatest } from "../../utils/latest";
import { loadModel, ModelError } from "./load";
import { MODEL_MESSAGES, type ModelFailure } from "./messages";
import { Viewer } from "./viewer";
import type { PaperModelFormat } from "../../templates/PaperPreview/kinds";

export interface ModelSceneProps {
    src: string;
    format: PaperModelFormat;
    label: string;
    controls: boolean;
    autoRotate: boolean;
    /** a model started loading; `progress` is how much of the file has arrived, or null while unknown */
    onLoading: (progress: number | null) => void;
    onReady: () => void;
    onFail: (failure: ModelFailure) => void;
}

export function ModelScene(props: ModelSceneProps) {
    let host!: HTMLDivElement;
    const [viewer, setViewer] = createSignal<Viewer | null>(null);
    // a new generation is a new viewer: after its context was lost, Retry starts one
    const [generation, setGeneration] = createSignal(0);
    const [reload, setReload] = createSignal(0);
    const [ready, setReady] = createSignal(false);
    const [animated, setAnimated] = createSignal(false);
    const [playing, setPlaying] = createSignal(false);

    createEffect(
        on(generation, () => {
            let made: Viewer;
            try {
                made = new Viewer(host, {
                    label: props.label,
                    onLost: () => {
                        batch(() => {
                            setViewer(null);
                            setReady(false);
                        });
                        props.onFail({ message: MODEL_MESSAGES.lost, retry: () => setGeneration((n) => n + 1) });
                    },
                });
            } catch (err) {
                // quiet: no WebGL here is said in place, as the viewer's failure
                props.onFail({ message: MODEL_MESSAGES.webgl });
                return;
            }
            setViewer(made);
            onCleanup(() => {
                setViewer(null);
                made.dispose();
            });
        }),
    );

    createEffect(on([viewer, () => props.label], ([shown, label]) => shown?.setLabel(label)));
    createEffect(on([viewer, () => props.autoRotate], ([shown, rotate]) => shown?.setAutoRotate(rotate)));
    createEffect(on([viewer, playing], ([shown, play]) => shown?.setPlaying(play)));

    // late answers lose: a model that arrives after a newer src, or after
    // the view went, is freed unseen
    const latest = createLatest();
    createEffect(
        on([viewer, () => props.src, () => props.format, reload], ([shown, src, format]) => {
            const current = latest();
            if (!shown) return;
            const controller = new AbortController();
            onCleanup(() => controller.abort());
            shown.clear();
            batch(() => {
                setReady(false);
                setAnimated(false);
                setPlaying(false);
            });
            props.onLoading(null);
            loadModel(src, format, {
                renderer: shown.renderer,
                signal: controller.signal,
                onProgress: (progress) => current() && props.onLoading(progress),
                onUpdate: shown.invalidate,
            }).then(
                (model) => {
                    if (!current() || viewer() !== shown) {
                        model.dispose();
                        return;
                    }
                    const { animated } = shown.show(model);
                    batch(() => {
                        setAnimated(animated);
                        setPlaying(animated);
                        setReady(true);
                    });
                    props.onReady();
                },
                (err: unknown) => {
                    if (!current() || controller.signal.aborted) return;
                    if (err instanceof ModelError) {
                        props.onFail({ message: err.message, retry: err.retryable ? () => setReload((n) => n + 1) : undefined });
                        return;
                    }
                    // not the file's fault: said in place, and thrown on so it's seen
                    props.onFail({ message: MODEL_MESSAGES.unreadable });
                    throw err;
                },
            );
        }),
    );

    return (
        <>
            <div ref={host} class={styles.stage} />
            <Show when={props.controls && ready()}>
                <PaperPreviewControls aria-label="3D view">
                    <Show when={animated()}>
                        <PaperButton icon variant="text" size="small" aria-label={playing() ? "Pause" : "Play"} onClick={() => setPlaying((on) => !on)}>
                            <PaperIcon>{playing() ? "pause" : "play_arrow"}</PaperIcon>
                        </PaperButton>
                    </Show>
                    <PaperButton icon variant="text" size="small" aria-label="Reset view" onClick={() => viewer()?.reset()}>
                        <PaperIcon>restart_alt</PaperIcon>
                    </PaperButton>
                </PaperPreviewControls>
            </Show>
        </>
    );
}
