import styles from "./index.module.css";
import {
    splitProps,
    createContext,
    useContext,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperText, type PaperTextProps, PRESETS } from "../PaperText";
import type { PaperColor, PaperTextPreset } from "../../types";
import { getVarCss, resolveColor } from "../../utils/theme";

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

    const presetValues = () =>
        local.preset ? PRESETS[local.preset] : undefined;
    const effectiveSize = () => local.size ?? presetValues()?.size ?? 3;
    const effectiveWeight = () => local.weight ?? presetValues()?.weight ?? 400;
    const spacingPreset = () => local.spacing ?? "normal";

    const fontSizeVar = () => getVarCss(`text-size-${effectiveSize()}`);
    const resolvedColor = () => resolveColor(local.color);

    const className = () =>
        [
            styles.PaperTextList,
            styles[spacingPreset()],
            local.rounded ? styles.rounded : "",
            local.family === "code" ? styles.code : "",
            local.preset ? styles[local.preset] : "",
            local.breakWord ? styles.breakWord : "",
            local.truncate ? styles.truncate : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const combinedStyle = () => {
        const customStyle = typeof local.style === "object" ? local.style : {};
        const extra: JSX.CSSProperties = {};

        if (local.breakWord) {
            extra["word-break"] = "break-word";
            extra["overflow-wrap"] = "break-word";
        }

        if (local.truncate) {
            if (typeof local.truncate === "number" && local.truncate > 1) {
                extra.display = "-webkit-box";
                extra["-webkit-line-clamp"] = local.truncate;
                extra["-webkit-box-orient"] = "vertical";
                extra.overflow = "hidden";
                extra["text-overflow"] = "ellipsis";
            } else {
                extra.overflow = "hidden";
                extra["text-overflow"] = "ellipsis";
                extra["white-space"] = "nowrap";
            }
        }

        return {
            "font-weight": effectiveWeight(),
            "font-size": fontSizeVar(),
            color: resolvedColor(),
            ...(local.type ? { "list-style-type": local.type } : {}),
            ...extra,
            ...customStyle,
        };
    };

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

    return local.ordered ? (
        <ol
            {...(rest as JSX.OlHTMLAttributes<HTMLOListElement>)}
            start={local.start}
            data-preset={local.preset}
            class={className()}
            classList={local.classList}
            style={combinedStyle()}
        >
            <TextListContext.Provider value={contextValue}>
                {local.children}
            </TextListContext.Provider>
        </ol>
    ) : (
        <ul
            {...(rest as JSX.HTMLAttributes<HTMLUListElement>)}
            data-preset={local.preset}
            class={className()}
            classList={local.classList}
            style={combinedStyle()}
        >
            <TextListContext.Provider value={contextValue}>
                {local.children}
            </TextListContext.Provider>
        </ul>
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
