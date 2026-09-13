import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";

export interface PaperEffectProps extends JSX.HTMLAttributes<HTMLDivElement> {
    colorless?: boolean;
    variant?: "blue" | "green" | "yellow" | "red" | "brand";
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
    ]);

    const isColorless = () => local.colorless || local.disabled;

    const className = () =>
        [
            styles.PaperEffect,
            local.variant ? styles[local.variant] : "",
            isColorless() ? styles.colorless : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
        >
            {local.children}
        </div>
    );
}
