import styles from "./index.module.css";
import {
    splitProps,
    createSignal,
    Show,
    type JSX,
    type ParentProps,
} from "solid-js";
import type { PaperSpacing, PaperBackgroundSurface } from "../../types";
import { resolveSpacing, resolveBackground } from "../../utils/theme";
import {
    PaperLayoutContext,
    usePaperLayout,
    resolveLayoutStyles,
    type PaperLayoutProps,
    type PaperLayoutContextValue,
} from "../../contexts/layout";

export type PaperFlexSpacing = PaperSpacing;
export type PaperFlexGap = PaperFlexSpacing;
export type PaperFlexPadding = PaperFlexSpacing;
export type PaperFlexBackground = PaperBackgroundSurface | (string & {});

export interface PaperFlexProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize">,
        PaperLayoutProps {
    direction?: "row" | "column" | "row-reverse" | "column-reverse";
    align?: JSX.CSSProperties["align-items"];
    justify?: JSX.CSSProperties["justify-content"];
    center?: boolean;
    background?: PaperFlexBackground;
    gap?: PaperFlexGap;
    padding?: PaperFlexPadding;
    paddingX?: PaperFlexPadding;
    paddingY?: PaperFlexPadding;
    wrap?: boolean | JSX.CSSProperties["flex-wrap"];
    resizable?: boolean;
    onResize?: (size: { width?: number; height?: number }) => void;
}

export function PaperFlex(props: ParentProps<PaperFlexProps>) {
    let containerRef: HTMLDivElement | undefined;
    const parentLayoutCtx = usePaperLayout();

    const [local, rest] = splitProps(props, [
        "direction",
        "align",
        "justify",
        "center",
        "fullWidth",
        "fullHeight",
        "background",
        "gap",
        "padding",
        "paddingX",
        "paddingY",
        "wrap",
        "overflow",
        "overflowX",
        "overflowY",
        "scrollable",
        "flex",
        "shrink",
        "grow",
        "minWidth",
        "minHeight",
        "maxWidth",
        "maxHeight",
        "resizable",
        "onResize",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const [resizedWidth, setResizedWidth] = createSignal<number | null>(null);
    const [resizedHeight, setResizedHeight] = createSignal<number | null>(null);
    const [isDragging, setIsDragging] = createSignal(false);

    const isRow = () =>
        local.direction === "row" || local.direction === "row-reverse";

    const handlePointerDown = (e: PointerEvent) => {
        if (!containerRef) return;
        e.preventDefault();

        const handleEl = e.currentTarget as HTMLElement;
        handleEl.setPointerCapture(e.pointerId);
        setIsDragging(true);

        const rect = containerRef.getBoundingClientRect();
        const computed = window.getComputedStyle(containerRef);

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = rect.width;
        const startH = rect.height;

        const parsePx = (val: string, fallback: number) => {
            const num = parseFloat(val);
            return isNaN(num) || num <= 0 ? fallback : num;
        };

        const minW = parsePx(computed.minWidth, 160);
        const maxW = parsePx(computed.maxWidth, window.innerWidth * 0.8);
        const minH = parsePx(computed.minHeight, 100);
        const maxH = parsePx(computed.maxHeight, window.innerHeight * 0.8);

        const handlePointerMove = (moveEv: PointerEvent) => {
            if (isRow()) {
                const deltaX =
                    local.direction === "row-reverse"
                        ? startX - moveEv.clientX
                        : moveEv.clientX - startX;
                const newW = Math.max(minW, Math.min(maxW, startW + deltaX));
                setResizedWidth(newW);
                local.onResize?.({ width: newW });
            } else {
                const deltaY =
                    local.direction === "column-reverse"
                        ? startY - moveEv.clientY
                        : moveEv.clientY - startY;
                const newH = Math.max(minH, Math.min(maxH, startH + deltaY));
                setResizedHeight(newH);
                local.onResize?.({ height: newH });
            }
        };

        const handlePointerUp = (upEv: PointerEvent) => {
            handleEl.releasePointerCapture(upEv.pointerId);
            setIsDragging(false);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
    };

    const style = () => {
        const gapVal = local.gap ? resolveSpacing(local.gap) : undefined;
        const paddingVal = local.padding
            ? resolveSpacing(local.padding)
            : undefined;
        const paddingXVal = local.paddingX
            ? resolveSpacing(local.paddingX)
            : undefined;
        const paddingYVal = local.paddingY
            ? resolveSpacing(local.paddingY)
            : undefined;
        const bgVal = local.background
            ? resolveBackground(local.background)
            : undefined;

        const layoutStyle = resolveLayoutStyles(local, parentLayoutCtx);

        const base: JSX.CSSProperties = {
            display: "flex",
            "flex-direction": local.direction || "column",
            "align-items": local.align ?? (local.center ? "center" : undefined),
            "justify-content":
                local.justify ?? (local.center ? "center" : undefined),
            "flex-wrap":
                typeof local.wrap === "boolean"
                    ? local.wrap
                        ? "wrap"
                        : "nowrap"
                    : local.wrap,
            gap: gapVal,
            padding: paddingVal,
            "padding-left": paddingXVal,
            "padding-right": paddingXVal,
            "padding-top": paddingYVal,
            "padding-bottom": paddingYVal,
            width:
                resizedWidth() !== null
                    ? `${resizedWidth()}px`
                    : layoutStyle.width,
            height:
                resizedHeight() !== null
                    ? `${resizedHeight()}px`
                    : layoutStyle.height,
            background: bgVal,
            ...layoutStyle,
        };

        return typeof local.style === "object"
            ? { ...base, ...local.style }
            : base;
    };

    const handleClass = () => {
        switch (local.direction) {
            case "row":
                return styles.resizeHandleRow;
            case "row-reverse":
                return styles.resizeHandleRowReverse;
            case "column-reverse":
                return styles.resizeHandleColumnReverse;
            case "column":
            default:
                return styles.resizeHandleColumn;
        }
    };

    const layoutContextValue: PaperLayoutContextValue = {
        direction: local.direction || "column",
        parentIsFlex: true,
    };

    return (
        <PaperLayoutContext.Provider value={layoutContextValue}>
            <div
                ref={containerRef}
                {...rest}
                class={[styles.PaperFlex, local.class].filter(Boolean).join(" ")}
                classList={local.classList}
                style={style()}
            >
                {local.children}
                <Show when={local.resizable}>
                    <div
                        class={[
                            handleClass(),
                            isDragging() ? styles.isDragging : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        onPointerDown={handlePointerDown}
                    />
                </Show>
            </div>
        </PaperLayoutContext.Provider>
    );
}
