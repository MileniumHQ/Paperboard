import { createEffect, createSignal, createUniqueId, on, onCleanup, onMount, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cx } from "../../utils/cx";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export interface MarketingTextProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "children"> {
    /** The words. */
    text: string;
    /** Font size in pixels; the shadows and grain scale with it. */
    size: number;
    /** The element that carries the words, for headings. A span when unset. */
    as?: "h1" | "h2" | "h3" | "p" | "span";
}

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Paperboard's display lettering: white Nunito, pressed into the page with
 * an accent-tinted inner edge, a soft drop and the paper grain. The real
 * words stay in the element for screen readers and search.
 */
export function MarketingText(props: MarketingTextProps) {
    const [local, rest] = splitProps(props, ["text", "size", "as", "class"]);
    const id = createUniqueId();
    const ratio = () => local.size / 200;
    // A first guess from Nunito's average advance; the rendered glyphs replace it.
    const estimate = (): Box => {
        const width = local.size * local.text.length * 0.56;
        const height = local.size * 1.36;
        return { x: -width / 2, y: -height / 2, width, height };
    };
    const [box, setBox] = createSignal<Box>(estimate());
    let face: SVGTextElement | undefined;

    const measure = () => {
        if (!face || !face.isConnected) return;
        const bbox = face.getBBox();
        if (!bbox.width || !bbox.height) return;
        setBox({ x: bbox.x, y: bbox.y, width: Math.ceil(bbox.width), height: Math.ceil(bbox.height) });
    };
    // Late answers lose: a measure for words that have since changed is dropped.
    let version = 0;
    const remeasure = () => {
        const mine = ++version;
        setBox(estimate());
        measure();
        void document.fonts.ready.then(() => {
            if (mine === version) measure();
        });
    };
    onMount(remeasure);
    createEffect(on(() => [local.text, local.size], remeasure, { defer: true }));
    onCleanup(() => {
        version++;
    });

    const glyphs = (className: string, filter: string, ref?: (el: SVGTextElement) => void) => (
        <text
            ref={ref}
            x="0"
            y="0"
            text-anchor="middle"
            dominant-baseline="central"
            font-size={String(local.size)}
            class={cx(styles.glyphs, className)}
            filter={`url(#${filter})`}
        >
            {local.text}
        </text>
    );

    return (
        <Dynamic component={local.as ?? "span"} {...rest} class={cx(styles.text, local.class)}>
            <span class={styles.label}>{local.text}</span>
            <svg
                class={styles.svg}
                aria-hidden="true"
                width={box().width}
                height={box().height}
                viewBox={`${box().x} ${box().y} ${box().width} ${box().height}`}
            >
                <defs>
                    <filter id={`${id}-drop`} x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation={19 * ratio()} class={styles.dropColor} flood-opacity="0.35" />
                    </filter>
                    <filter id={`${id}-inner`} x="-30%" y="-30%" width="160%" height="160%">
                        <feComponentTransfer in="SourceAlpha" result="inverted">
                            <feFuncA type="linear" slope="-1" intercept="1" />
                        </feComponentTransfer>
                        <feOffset in="inverted" dx={6 * ratio()} dy={6 * ratio()} result="shifted" />
                        <feGaussianBlur in="shifted" stdDeviation={2 * ratio()} result="blurred" />
                        <feComposite in="blurred" in2="SourceAlpha" operator="in" result="edge" />
                        <feFlood class={styles.innerColor} flood-opacity="0.4" result="tint" />
                        <feComposite in="tint" in2="edge" operator="in" result="tinted" />
                        <feMerge>
                            <feMergeNode in="SourceGraphic" />
                            <feMergeNode in="tinted" />
                        </feMerge>
                    </filter>
                    <filter id={`${id}-grain`} x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence
                            type="fractalNoise"
                            baseFrequency={0.8 * Math.max(0.4, Math.min(3, 200 / local.size))}
                            numOctaves="3"
                            stitchTiles="stitch"
                            result="noise"
                        />
                        <feColorMatrix
                            type="matrix"
                            in="noise"
                            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.033 0.033 0.033 0 0"
                            result="speckle"
                        />
                        <feFlood class={styles.inkColor} result="ink" />
                        <feComposite in="ink" in2="speckle" operator="in" result="inkSpeckle" />
                        <feComposite in="inkSpeckle" in2="SourceAlpha" operator="in" />
                    </filter>
                </defs>
                <g filter={`url(#${id}-drop)`}>
                    {glyphs(styles.face, `${id}-inner`, (el) => (face = el))}
                    {glyphs(styles.grain, `${id}-grain`)}
                </g>
            </svg>
        </Dynamic>
    );
}
