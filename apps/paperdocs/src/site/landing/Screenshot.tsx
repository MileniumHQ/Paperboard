import { withBase } from "../../utils/base";
import { ICON_WIDTHS, SCREEN_WIDTHS, webpSrcset } from "./images";

/**
 * A marketing screenshot. Screenshots are 4:3 (captured at 1600 × 1200), so
 * the box is reserved before the file arrives. Browsers pick a WebP copy sized
 * for the slot from `sizes`; the PNG is the fallback. Offscreen shots load
 * lazily; the one above the fold passes `priority`.
 */
export function Screenshot(props: {
    src: string;
    alt: string;
    sizes: string;
    class?: string;
    priority?: boolean;
}) {
    return (
        <picture class="marketing-picture">
            <source type="image/webp" srcset={webpSrcset(props.src, SCREEN_WIDTHS)} sizes={props.sizes} />
            <img
                src={withBase(props.src)}
                alt={props.alt}
                class={["marketing-screenshot", props.class].filter(Boolean).join(" ")}
                width={1600}
                height={1200}
                loading={props.priority ? "eager" : "lazy"}
                fetchpriority={props.priority ? "high" : undefined}
                decoding="async"
            />
        </picture>
    );
}

/** A square panel icon, served as a small WebP copy of its PNG. */
export function Icon(props: { src: string; size: number; class?: string; lazy?: boolean; draggable?: boolean }) {
    return (
        <picture class="marketing-picture">
            <source type="image/webp" srcset={webpSrcset(props.src, ICON_WIDTHS)} sizes={`${props.size}px`} />
            <img
                class={props.class}
                src={withBase(props.src)}
                width={props.size}
                height={props.size}
                alt=""
                loading={props.lazy ? "lazy" : "eager"}
                decoding="async"
                draggable={props.draggable === false ? "false" : undefined}
            />
        </picture>
    );
}
