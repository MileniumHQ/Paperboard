import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import {
    usePaperLayout,
    resolveLayoutStyles,
    type PaperLayoutProps,
} from "../../contexts/layout";

export interface PaperContainerProps
    extends JSX.HTMLAttributes<HTMLDivElement>,
        PaperLayoutProps {}

export function PaperContainer(props: ParentProps<PaperContainerProps>) {
    const layoutCtx = usePaperLayout();
    const [local, rest] = splitProps(props, [
        "class",
        "classList",
        "style",
        "children",
        "flex",
        "shrink",
        "grow",
        "minWidth",
        "minHeight",
        "maxWidth",
        "maxHeight",
        "fullWidth",
        "fullHeight",
        "scrollable",
        "overflow",
        "overflowX",
        "overflowY",
    ]);

    const style = () => {
        const layoutStyle = resolveLayoutStyles(local, layoutCtx);
        return typeof local.style === "object"
            ? { ...layoutStyle, ...local.style }
            : layoutStyle;
    };

    return (
        <div
            {...rest}
            class={[styles.PaperContainer, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            style={style()}
        >
            {local.children}
        </div>
    );
}
