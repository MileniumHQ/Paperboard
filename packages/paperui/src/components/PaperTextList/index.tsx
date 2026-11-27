import styles from "./index.module.css";
import {
    splitProps,
    children,
    createContext,
    useContext,
    type JSX,
    type ParentProps,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperText, textStyle, type PaperTextProps } from "../PaperText";
import type { PaperColor, PaperTextPreset } from "../../types";
import { cx } from "../../utils/cx";

export interface PaperTextListProps
    extends JSX.HTMLAttributes<HTMLUListElement | HTMLOListElement> {
    ordered?: boolean;
    /** First number of an ordered list. Ignored when unordered. */
    start?: number;
    type?: "disc" | "circle" | "square" | "decimal" | "none" | (string & {});
    size?: number;
    weight?: number;
    spacing?: "compact" | "normal" | "relaxed";
    preset?: PaperTextPreset;
    color?: PaperColor;
    family?: "body" | "code";
    rounded?: boolean;
    breakWord?: boolean;
    truncate?: boolean | number;
}

export interface TextListContextValue {
    preset?: PaperTextPreset;
    size?: number;
    weight?: number;
    color?: PaperColor;
    family?: "body" | "code";
    rounded?: boolean;
    breakWord?: boolean;
    truncate?: boolean | number;
}

const TextListContext = createContext<() => TextListContextValue>();

export function useTextListContext() {
    return useContext(TextListContext);
}

export function PaperTextList(props: ParentProps<PaperTextListProps>) {
    const [local, rest] = splitProps(props, [
        "ordered",
        "start",
        "type",
        "size",
        "weight",
        "spacing",
        "preset",
        "color",
        "family",
        "rounded",
        "breakWord",
        "truncate",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const spacingPreset = () => local.spacing ?? "normal";

    const className = () =>
        cx(
            styles.PaperTextList,
            styles[spacingPreset()],
            local.rounded ? styles.rounded : "",
            local.family === "code" ? styles.code : "",
            local.preset ? styles[local.preset] : "",
            local.breakWord ? styles.breakWord : "",
            local.truncate ? styles.truncate : "",
            local.class,
        );

    const contextValue = () => ({
        preset: local.preset,
        size: local.size,
        weight: local.weight,
        color: local.color,
        family: local.family,
        rounded: local.rounded,
        breakWord: local.breakWord,
        truncate: local.truncate,
    });

    // built once: switching between numbered and bulleted swaps the list
    // element and keeps its items
    const items = children(() => (
        <TextListContext.Provider value={contextValue}>{local.children}</TextListContext.Provider>
    ));

    return (
        <Dynamic
            component={local.ordered ? "ol" : "ul"}
            {...(rest as JSX.OlHTMLAttributes<HTMLOListElement>)}
            start={local.ordered ? local.start : undefined}
            data-preset={local.preset}
            class={className()}
            classList={local.classList}
            style={textStyle(local, 3, local.type ? { "list-style-type": local.type } : {})}
        >
            {items()}
        </Dynamic>
    );
}

PaperTextList.Item = function PaperTextListItem(props: PaperTextProps) {
    const parentContext = useTextListContext();
    const inherited = () => parentContext?.() ?? {};
    return (
        <PaperText
            {...props}
            as={props.as || "li"}
            preset={props.preset ?? inherited().preset}
            size={props.size ?? inherited().size}
            weight={props.weight ?? inherited().weight}
            color={props.color ?? inherited().color}
            family={props.family ?? inherited().family}
            rounded={props.rounded ?? inherited().rounded}
            breakWord={props.breakWord ?? inherited().breakWord}
            truncate={props.truncate ?? inherited().truncate}
        />
    );
};
