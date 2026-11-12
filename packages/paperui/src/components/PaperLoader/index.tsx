import styles from "./index.module.css";
import { createEffect, createSignal, on, onCleanup, splitProps, Show, type JSX } from "solid-js";
import { haptic } from "../../utils/haptics";
import { LoaderStatus } from "../../types";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export type PaperLoaderSize = "small" | "medium" | "large";

export interface PaperLoaderProps extends JSX.HTMLAttributes<HTMLDivElement> {
    percent?: number;
    loaderStatus: LoaderStatus;
    size?: PaperLoaderSize;
    label?: JSX.Element | string;
    /**
     * Milliseconds to wait before appearing. A wait that ends sooner never
     * flashes a loader on screen.
     */
    delay?: number;
    /**
     * Something short inside the ring, such as how many steps are left. It
     * makes way for the check or cross when the loader finishes.
     */
    children?: JSX.Element;
    /**
     * Fills its container and sits in the middle of it, with room from every
     * edge and the label centered under the ring: the way to show that a
     * whole page or area is loading.
     */
    centered?: boolean;
}

export interface PaperLoaderGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {}

const CIRCUMFERENCE = 97.39;

// loaders finishing together (a list of steps) are felt once
const FINISH_HAPTIC_GAP = 400;
let lastFinishHaptic = 0;
function finishHaptic(status: LoaderStatus) {
    const now = Date.now();
    if (now - lastFinishHaptic < FINISH_HAPTIC_GAP) return;
    lastFinishHaptic = now;
    haptic(status === "success" ? "loaded" : "failed");
}

export function PaperLoader(props: PaperLoaderProps) {
    const [local, rest] = splitProps(props, [
        "percent",
        "loaderStatus",
        "size",
        "label",
        "class",
        "classList",
        "style",
        "delay",
        "children",
        "centered",
    ]);

    const [due, setDue] = createSignal(!local.delay);
    if (local.delay) {
        const timer = setTimeout(() => setDue(true), local.delay);
        onCleanup(() => clearTimeout(timer));
    }

    const loaderClass = () =>
        [styles.PaperLoader, local.class].filter(Boolean).join(" ");

    const clampedPercent = () => Math.min(100, Math.max(0, local.percent || 0));
    const isIndeterminate = () => local.loaderStatus === "indeterminate";
    const isWaiting = () => local.loaderStatus === "waiting";
    const isError = () => local.loaderStatus === "error";
    const isSuccess = () => local.loaderStatus === "success";
    const isFull = () => isSuccess() || isError();
    const strokeDashoffset = () => CIRCUMFERENCE * (1 - clampedPercent() / 100);

    // finishing in front of the person is felt: the check's pop and ripple,
    // or a failure's two knocks. A loader that mounts already finished isn't.
    createEffect(
        on(
            () => local.loaderStatus,
            (status, before) => {
                if (!due() || status === before) return;
                if (status === "success" || status === "error") finishHaptic(status);
            },
            { defer: true },
        ),
    );

    return (
        <Show when={due()}>
        <div
            {...rest}
            class={styles.elWrapper}
            classList={{
                [styles.waiting]: isWaiting(),
                [styles.centered]: Boolean(local.centered),
                [styles[local.size ?? "medium"]]: true,
                ...local.classList,
            }}
            style={typeof local.style === "object" ? local.style : {}}
        >
            <span class={loaderClass()}>
                <svg viewBox="0 0 40 40" class={styles.loaderSvg}>
                    <path
                        class={styles.loaderTrack}
                        d="M 20 4.5 A 15.5 15.5 0 0 1 20 35.5 A 15.5 15.5 0 0 1 20 4.5"
                        fill="none"
                        stroke-width="7"
                    />
                    <path
                        class={styles.loaderProgress}
                        classList={{
                            [styles.error]: isError(),
                            [styles.success]: isSuccess(),
                            [styles.hidden]: isIndeterminate(),
                        }}
                        stroke-dasharray={`${CIRCUMFERENCE}`}
                        stroke-dashoffset={`${strokeDashoffset()}`}
                        opacity={
                            clampedPercent() <= 0 && !isSuccess() ? "0" : "1"
                        }
                        stroke-linecap="round"
                        d="M 20 4.5 A 15.5 15.5 0 0 1 20 35.5 A 15.5 15.5 0 0 1 20 4.5"
                        fill="none"
                        stroke-width="7"
                    />
                    {/* its own path: the spinning arc cross-fades instead of
                        inheriting the determinate rotation (no snap when the
                        phase changes) */}
                    <path
                        class={styles.loaderProgress}
                        classList={{
                            [styles.indeterminate]: true,
                            [styles.hidden]: !isIndeterminate(),
                        }}
                        stroke-dasharray={`${CIRCUMFERENCE}`}
                        stroke-dashoffset={`${CIRCUMFERENCE * 0.65}`}
                        stroke-linecap="round"
                        d="M 20 4.5 A 15.5 15.5 0 0 1 20 35.5 A 15.5 15.5 0 0 1 20 4.5"
                        fill="none"
                        stroke-width="7"
                    />
                </svg>
                <Show when={local.children !== undefined && local.children !== null && !isFull()}>
                    <span class={styles.center}>{local.children}</span>
                </Show>
                <span
                    class={styles.statusFinisher}
                    classList={{
                        [styles.full]: isFull(),
                        [styles.error]: isError(),
                    }}
                >
                    {/* The finisher glyph renders through PaperIcon like
                        every other icon, not a pseudo-element ligature. */}
                    <Show when={isFull()}>
                        <PaperIcon class={styles.finisherIcon}>
                            {isError() ? "close" : "check"}
                        </PaperIcon>
                    </Show>
                </span>
            </span>
            <Show when={local.label}>
                {/* a small loader sits in lists of many steps: its label shrinks with it */}
                <PaperText size={local.size === "small" ? 2 : 4} class={styles.labelWrapper}>
                    {local.label}
                </PaperText>
            </Show>
        </div>
        </Show>
    );
}

export function PaperLoaderGroup(props: PaperLoaderGroupProps) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);
    const className = () =>
        [styles.PaperLoaderGroup, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            {local.children}
        </div>
    );
}
