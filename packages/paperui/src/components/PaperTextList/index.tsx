import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { PaperText, type PaperTextProps } from "../PaperText";
import { getVarCss } from "../../utils/theme";

export interface PaperTextListProps
    extends JSX.HTMLAttributes<HTMLUListElement | HTMLOListElement> {
    ordered?: boolean;
    type?: "disc" | "circle" | "square" | "decimal" | "none" | (string & {});
    size?: number;
    weight?: number;
    spacing?: "compact" | "normal" | "relaxed";
}

export function PaperTextList(props: ParentProps<PaperTextListProps>) {
    const [local, rest] = splitProps(props, [
        "ordered",
        "type",
        "size",
        "weight",
        "spacing",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const effectiveSize = () => local.size ?? 3;
    const effectiveWeight = () => local.weight ?? 400;
    const spacingPreset = () => local.spacing ?? "normal";

    const fontSizeVar = () => getVarCss(`text-size-${effectiveSize()}`);

    const className = () =>
        [
            styles.PaperTextList,
            styles[spacingPreset()],
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const combinedStyle = () => {
        const customStyle = typeof local.style === "object" ? local.style : {};
        return {
            "font-weight": effectiveWeight(),
            "font-size": fontSizeVar(),
            ...(local.type ? { "list-style-type": local.type } : {}),
            ...customStyle,
        };
    };

    return local.ordered ? (
        <ol
            {...(rest as JSX.OlHTMLAttributes<HTMLOListElement>)}
            class={className()}
            classList={local.classList}
            style={combinedStyle()}
        >
            {local.children}
        </ol>
    ) : (
        <ul
            {...(rest as JSX.HTMLAttributes<HTMLUListElement>)}
            class={className()}
            classList={local.classList}
            style={combinedStyle()}
        >
            {local.children}
        </ul>
    );
}

PaperTextList.Item = function PaperTextListItem(props: PaperTextProps) {
    return <PaperText as="li" {...props} />;
};
