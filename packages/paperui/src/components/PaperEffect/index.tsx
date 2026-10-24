import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { roleVars, isPaperRole } from "../../utils/colors";
import { haptic } from "../../utils/haptics";
import type { PaperRole } from "../../types";

export interface PaperEffectProps extends JSX.HTMLAttributes<HTMLDivElement> {
    colorless?: boolean;
    variant?: PaperRole;
    disabled?: boolean;
}

export function PaperEffect(props: PaperEffectProps) {
    const [local, rest] = splitProps(props, [
        "colorless",
        "variant",
        "disabled",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const isColorless = () => local.colorless || local.disabled;

    const roleStyle = () =>
        local.variant && isPaperRole(local.variant)
            ? roleVars(local.variant)
            : {};

    const className = () =>
        [
            styles.PaperEffect,
            isColorless() ? styles.colorless : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    // a finger lifted where it pressed feels the paper go down and spring
    // back; a press that became a scroll is cancelled and feels nothing
    let pressed: number | null = null;
    const onPress = (e: PointerEvent) => {
        pressed = e.pointerType === "touch" ? e.pointerId : null;
    };
    const onRelease = (e: PointerEvent) => {
        if (pressed !== e.pointerId) return;
        pressed = null;
        const el = e.currentTarget as HTMLElement;
        // dressed as disabled (see the stylesheet): no press to feel
        if (local.disabled || el.querySelector(":disabled, [class*='disabled']")) return;
        haptic(local.variant === "danger" ? "thud" : "paper");
    };
    const onCancel = () => {
        pressed = null;
    };

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={roleStyle()}
            on:pointerdown={onPress}
            on:pointerup={onRelease}
            on:pointercancel={onCancel}
        >
            {local.children}
        </div>
    );
}
