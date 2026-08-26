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

export type PaperFlexSpacing = PaperSpacing;
export type PaperFlexGap = PaperFlexSpacing;
export type PaperFlexPadding = PaperFlexSpacing;
export type PaperFlexBackground = PaperBackgroundSurface | (string & {});

export interface PaperFlexProps extends Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    "onResize"
> {
    direction?: "row" | "column" | "row-reverse" | "column-reverse";
    align?: JSX.CSSProperties["align-items"];
    justify?: JSX.CSSProperties["justify-content"];
    center?: boolean;
    fullWidth?: boolean;
    fullHeight?: boolean;
    background?: PaperFlexBackground;
    gap?: PaperFlexGap;
    padding?: PaperFlexPadding;
    paddingX?: PaperFlexPadding;
    paddingY?: PaperFlexPadding;
    wrap?: boolean | JSX.CSSProperties["flex-wrap"];
    overflow?: JSX.CSSProperties["overflow"];
    resizable?: boolean;
    onResize?: (size: { width?: number; height?: number }) => void;
}

export function PaperFlex(props: ParentProps<PaperFlexProps>) {
    let containerRef: HTMLDivElement | undefined;

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
                const nextW = Math.max(minW, Math.min(maxW, startW + deltaX));
                setResizedWidth(nextW);
                local.onResize?.({ width: nextW });
            } else {
                const deltaY =
                    local.direction === "column-reverse"
                        ? startY - moveEv.clientY
                        : moveEv.clientY - startY;
                const nextH = Math.max(minH, Math.min(maxH, startH + deltaY));
                setResizedHeight(nextH);
                local.onResize?.({ height: nextH });
            }
        };

        const handlePointerUp = (upEv: PointerEvent) => {
            handleEl.releasePointerCapture(upEv.pointerId);
            setIsDragging(false);
            handleEl.removeEventListener("pointermove", handlePointerMove);
            handleEl.removeEventListener("pointerup", handlePointerUp);
        };

        handleEl.addEventListener("pointermove", handlePointerMove);
        handleEl.addEventListener("pointerup", handlePointerUp);
    };

    const style = () => {
        const gapVal = resolveSpacing(local.gap);
        const paddingVal = resolveSpacing(local.padding);
        const paddingXVal = resolveSpacing(local.paddingX);
        const paddingYVal = resolveSpacing(local.paddingY);

        const bgVal = resolveBackground(local.background);

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
            overflow: local.overflow,
            "padding-left": paddingXVal,
            "padding-right": paddingXVal,
            "padding-top": paddingYVal,
            "padding-bottom": paddingYVal,
            width:
                resizedWidth() !== null
                    ? `${resizedWidth()}px`
                    : local.fullWidth
                      ? "100%"
                      : undefined,
            height:
                resizedHeight() !== null
                    ? `${resizedHeight()}px`
                    : local.fullHeight
                      ? "100%"
                      : undefined,
            background: bgVal,
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

    return (
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
    );
}
