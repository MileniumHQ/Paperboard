import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";

export interface PaperProgressProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value?: number;
    max?: number;
    /** fill color role; defaults to the primary action color */
    variant?: PaperRole;
}

export function PaperProgress(props: PaperProgressProps) {
    const [local, rest] = splitProps(props, [
        "value",
        "max",
        "variant",
        "class",
        "classList",
        "style",
    ]);

    const roleStyle = () =>
        isPaperRole(local.variant) ? roleVars(local.variant) : {};

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
            local.variant ? styles.variantRole : "",
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
            style={{ ...roleStyle(), ...(typeof local.style === "object" ? local.style : {}) }}
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
