import styles from "./index.module.css";
import { createEffect, createMemo, createSignal, Match, on, Show, splitProps, Switch, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperEmptyState } from "../PaperEmptyState";
import { PaperLoader } from "../PaperLoader";
import { previewHost } from "../../templates/PaperPreview/controls";
import { previewModelFormat, type PaperModelFormat } from "../../templates/PaperPreview/kinds";
import { cx } from "../../utils/cx";
import { MODEL_MESSAGES, type ModelFailure } from "./messages";
import type { ModelSceneProps } from "./ModelScene";

export interface PaperModelProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    /** URL of the model; blob: URLs work, with `format` or `name` to say what it is. A new one replaces the model. */
    src: string;
    /** The file's format; without it, it is read from the extension of `name`, then of `src`. */
    format?: PaperModelFormat;
    /** The file's name, for its format when `format` isn't given. */
    name?: string;
    /** Accessible name for the viewer. Defaults to `name`, then "3D model". */
    label?: string;
    /** Called with the message the viewer shows when the model can't be shown. */
    onError?: (message: string) => void;
    /** Reset view, and play and pause for an animated model, over the model. Defaults to true. */
    controls?: boolean;
    /** Turns the model slowly while nobody is moving it. */
    autoRotate?: boolean;
}

// three.js is most of a megabyte: the scene, and three.js with it, load the
// first time a model is shown. A failed load is forgotten, so Retry loads again.
type Scene = (props: ModelSceneProps) => JSX.Element;
let scene: Promise<Scene> | null = null;
function loadScene(): Promise<Scene> {
    scene ??= import("./ModelScene").then(
        (module) => module.ModelScene,
        (err: unknown) => {
            scene = null;
            throw err;
        },
    );
    return scene;
}

type State = { status: "loading"; progress: number | null } | { status: "ready" } | ({ status: "failed" } & ModelFailure);

// a src's own path, without the query or fragment that would hide its extension
function pathOf(src: string): string {
    try {
        return new URL(src, document.baseURI).pathname;
    } catch (err) {
        // quiet: a src that isn't a URL is read as a path
        return src;
    }
}

/**
 * A 3D model viewer that fills its container: the model framed at a
 * three-quarter angle on a soft contact shadow, turned with a drag, zoomed
 * with the wheel or a pinch, moved with a right-drag or two fingers.
 * Double-click puts it back.
 */
export function PaperModel(props: PaperModelProps) {
    const [local, rest] = splitProps(props, ["src", "format", "name", "label", "onError", "controls", "autoRotate", "class", "classList"]);
    const [View, setView] = createSignal<Scene>();
    const [state, setState] = createSignal<State>({ status: "loading", progress: null });
    const format = createMemo(() => local.format ?? previewModelFormat(local.name ?? pathOf(local.src)));
    const label = () => local.label ?? local.name ?? "3D model";

    const fail = (failure: ModelFailure) => {
        setState({ status: "failed", ...failure });
        local.onError?.(failure.message);
    };

    const start = () => {
        setState({ status: "loading", progress: null });
        loadScene().then(
            (component) => setView(() => component),
            () => fail({ message: MODEL_MESSAGES.viewer, retry: start }),
        );
    };
    start();

    // a file of no format the viewer knows fails before anything loads; a new src is a new failure
    createEffect(
        on([() => local.src, format], ([, known]) => {
            if (!known) fail({ message: MODEL_MESSAGES.format });
        }),
    );

    const failure = () => {
        const current = state();
        return current.status === "failed" ? current : undefined;
    };
    const progress = () => {
        const current = state();
        return current.status === "loading" ? current.progress : undefined;
    };

    return (
        <div
            role="group"
            aria-label={label()}
            {...rest}
            class={cx(styles.PaperModel, previewHost, local.class)}
            classList={local.classList}
            aria-busy={state().status === "loading"}
        >
            <Show when={View() && format()}>
                {(known) => (
                    <Dynamic
                        component={View()!}
                        src={local.src}
                        format={known()}
                        label={label()}
                        controls={local.controls ?? true}
                        autoRotate={local.autoRotate ?? false}
                        onLoading={(progress: number | null) => setState({ status: "loading", progress })}
                        onReady={() => setState({ status: "ready" })}
                        onFail={fail}
                    />
                )}
            </Show>
            <Switch>
                <Match when={state().status === "loading"}>
                    <PaperLoader
                        class={styles.overlay}
                        loaderStatus={progress() == null ? "indeterminate" : "loading"}
                        percent={(progress() ?? 0) * 100}
                        delay={150}
                    />
                </Match>
                <Match when={failure()}>
                    {(shown) => (
                        <PaperEmptyState class={styles.overlay} icon="error" role="alert" title={shown().message}>
                            <Show when={shown().retry}>
                                {(retry) => (
                                    <PaperButton size="small" onClick={() => retry()()}>
                                        Retry
                                    </PaperButton>
                                )}
                            </Show>
                        </PaperEmptyState>
                    )}
                </Match>
            </Switch>
        </div>
    );
}

/**
 * Draws the model at `src` as a `size`×`size` PNG with a transparent
 * background, framed and lit as PaperModel shows it. Every thumbnail is
 * drawn by one shared offscreen renderer, one at a time, so a folder of
 * models costs one WebGL context. Rejects with the reason PaperModel would
 * show, or with `signal`'s reason once it aborts. Loads three.js on first
 * use, like PaperModel.
 */
export async function renderModelThumbnail(src: string, format: PaperModelFormat, size: number, signal?: AbortSignal): Promise<Blob> {
    const { renderModelThumbnail: render } = await import("./thumbnail");
    return render(src, format, size, signal);
}
