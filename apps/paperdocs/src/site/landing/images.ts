import { withBase } from "../../utils/base";

// Responsive WebP copies of the marketing PNGs. The PNG in public/ stays the
// source and the <img> fallback; scripts/marketing-images.mjs writes each
// /img/... variant named here into the build, resized from that PNG. A
// variant wider than its source fails the build, so a width descriptor never
// claims pixels the file does not have.

/** Screenshots fill anything from a phone column to a 1100px card. */
export const SCREEN_WIDTHS = [480, 960, 1600] as const;
/** Icons render at 28–84 CSS pixels. */
export const ICON_WIDTHS = [96, 192] as const;

/** `/screens/gameserver.png` at 960 -> `/img/screens/gameserver-960.webp`. */
export function variantPath(src: string, width: number): string {
    const match = /^\/((?:screens|pictures)\/[\w-]+|[\w-]+)\.png$/.exec(src);
    if (!match) throw new Error(`paperdocs: no responsive variants for ${src}`);
    return `/img/${match[1]}-${width}.webp`;
}

export function webpSrcset(src: string, widths: readonly number[]): string {
    return widths.map((width) => `${withBase(variantPath(src, width))} ${width}w`).join(", ");
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/**
 * A square icon as an HTML string, for the chrome fragments that are handed
 * to Solid as innerHTML. Icons sit in closed menus or below the fold, so they
 * load lazily unless `eager` is set.
 */
export function iconHtml(props: { src: string; size: number; class?: string; eager?: boolean }): string {
    const cls = props.class ? ` class="${escapeAttribute(props.class)}"` : "";
    return (
        `<picture class="marketing-picture"><source type="image/webp" srcset="${escapeAttribute(webpSrcset(props.src, ICON_WIDTHS))}" sizes="${props.size}px" />` +
        `<img${cls} src="${escapeAttribute(withBase(props.src))}" width="${props.size}" height="${props.size}" alt=""` +
        ` loading="${props.eager ? "eager" : "lazy"}" decoding="async" /></picture>`
    );
}
