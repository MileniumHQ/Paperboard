import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";

export type PaperCenteredInterfacePreset =
    | "small"
    | "compact"
    | "medium"
    | "large"
    | "wide"
    | "full"
    | "fullscreen"
    | "auto"
    | "fit";

export interface PaperCenteredInterfaceProps extends JSX.HTMLAttributes<HTMLDivElement> {
    preset?: PaperCenteredInterfacePreset;
    size?: PaperCenteredInterfacePreset;
    width?: string;
    height?: string;
}

export function PaperCenteredInterface(
    props: ParentProps<PaperCenteredInterfaceProps>,
) {
    const [local, rest] = splitProps(props, [
        "preset",
        "size",
        "width",
        "height",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const activePreset = () => local.preset ?? local.size;

    const className = () =>
        [
            styles.PaperCenteredInterface,
            activePreset() ? styles[activePreset()!] : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const wrapperStyle = () => {
        const s: Record<string, string | undefined> = {};
        if (local.width) s.width = local.width;
        if (local.height) s.height = local.height;
        return Object.keys(s).length > 0 ? s : undefined;
    };

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={local.style}
            data-preset={activePreset()}
        >
            <div class={styles.interfaceWrapper} style={wrapperStyle()}>
                {local.children}
            </div>
        </div>
    );
}
