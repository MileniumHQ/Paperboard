import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";

export interface PaperProgressProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value?: number;
    max?: number;
}

export function PaperProgress(props: PaperProgressProps) {
    const [local, rest] = splitProps(props, [
        "value",
        "max",
        "class",
        "classList",
        "style",
    ]);

    const maxVal = () =>
        local.max !== undefined && local.max > 0 ? local.max : 100;

    const isIndeterminate = () => local.value === undefined;

    const clampedPercent = () => {
        if (local.value === undefined) return 0;
        return Math.min(100, Math.max(0, (local.value / maxVal()) * 100));
    };

    const className = () =>
        [
            styles.PaperProgress,
            isIndeterminate() ? styles.indeterminate : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            role="progressbar"
            aria-valuenow={local.value !== undefined ? local.value : undefined}
            aria-valuemin={0}
            aria-valuemax={maxVal()}
            aria-valuetext={
                local.value !== undefined
                    ? `${Math.round(clampedPercent())}%`
                    : undefined
            }
            class={className()}
            classList={local.classList}
            style={local.style}
        >
            <div
                class={styles.bar}
                style={
                    !isIndeterminate()
                        ? {
                              width: `${clampedPercent()}%`,
                          }
                        : {}
                }
            />
        </div>
    );
}
