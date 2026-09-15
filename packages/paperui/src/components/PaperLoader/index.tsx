import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import { LoaderStatus } from "../../types";
import { PaperText } from "../PaperText";

export type PaperLoaderSize = "small" | "medium" | "large";

export interface PaperLoaderProps extends JSX.HTMLAttributes<HTMLDivElement> {
    percent?: number;
    loaderStatus: LoaderStatus;
    size?: PaperLoaderSize;
    label?: JSX.Element | string;
}

export interface PaperLoaderGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {}

const CIRCUMFERENCE = 97.39;

export function PaperLoader(props: PaperLoaderProps) {
    const [local, rest] = splitProps(props, [
        "percent",
        "loaderStatus",
        "size",
        "label",
        "class",
        "classList",
        "style",
    ]);

    const loaderClass = () =>
        [styles.PaperLoader, local.class].filter(Boolean).join(" ");

    const clampedPercent = () => Math.min(100, Math.max(0, local.percent || 0));
    const isIndeterminate = () => local.loaderStatus === "indeterminate";
    const isWaiting = () => local.loaderStatus === "waiting";
    const isError = () => local.loaderStatus === "error";
    const isSuccess = () => local.loaderStatus === "success";
    const isFull = () => isSuccess() || isError();
    const strokeDashoffset = () => CIRCUMFERENCE * (1 - clampedPercent() / 100);

    return (
        <div
            {...rest}
            class={styles.elWrapper}
            classList={{
                [styles.waiting]: isWaiting(),
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
                <span
                    class={styles.statusFinisher}
                    classList={{
                        [styles.full]: isFull(),
                        [styles.error]: isError(),
                    }}
                ></span>
            </span>
            <Show when={local.label}>
                <PaperText size={4} class={styles.labelWrapper}>
                    {local.label}
                </PaperText>
            </Show>
        </div>
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
