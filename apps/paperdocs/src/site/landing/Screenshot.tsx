import { withBase } from "../../utils/base";
import { DEVICE_WIDTHS, ICON_WIDTHS, RENDER_WIDTHS, SCREEN_WIDTHS, webpSrcset } from "./images";
import RENDERS from "./renders.json";

/**
 * A marketing screenshot. Screenshots are the panels' 4:3 store screenshots
 * (1360 × 1020, copied by scripts/store-screens.mjs), so
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
                width={1360}
                height={1020}
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

/**
 * A device from public/renders, drawn ahead of time from the landing's
 * low-poly models by scripts/render-models.mjs. Its box comes from the size
 * that script recorded, so it is reserved before the file arrives.
 */
export function Render(props: { name: string; alt: string; sizes: string; priority?: boolean; device?: boolean }) {
    const size = () => {
        const known = (RENDERS as Record<string, { width: number; height: number }>)[props.name];
        if (!known) throw new Error(`paperdocs: no render named ${props.name}; run bun run renders`);
        return known;
    };
    const src = () => `/renders/${props.name}.png`;
    return (
        <picture class="marketing-picture">
            <source
                type="image/webp"
                srcset={webpSrcset(src(), props.device ? DEVICE_WIDTHS : RENDER_WIDTHS)}
                sizes={props.sizes}
            />
            <img
                src={withBase(src())}
                alt={props.alt}
                class="marketing-render"
                width={size().width}
                height={size().height}
                loading={props.priority ? "eager" : "lazy"}
                fetchpriority={props.priority ? "high" : undefined}
                decoding="async"
                draggable={false}
            />
        </picture>
    );
}
