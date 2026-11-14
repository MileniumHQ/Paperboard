import { resolveSize } from "../../utils/theme";
import type { PaperSize } from "../../types";
import styles from "./index.module.css";
import { children, splitProps, For, Show, type JSX, type ParentProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperText } from "../PaperText";
import { PaperIcon } from "../PaperIcon";
import { PaperEffect } from "../PaperEffect";
import { mergeStyle } from "../../utils/style";
import { cx } from "../../utils/cx";

export interface PaperMediaCardProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "onClick"> {
    /**
     * The picture across the card's top: an address, a list of addresses
     * (up to four tile it as one picture, for a card that stands for
     * several things) or any element.
     */
    banner?: string | readonly string[] | JSX.Element;
    /** What the banner shows, for a picture or a tiled set of them. */
    bannerAlt?: string;
    bannerHeight?: string;
    icon?: string | JSX.Element;
    /**
     * Portrait cover art (2:3) in the icon's place. With a banner it
     * overlaps the banner's bottom edge and the text sits beside it;
     * without one it stands above the title. It replaces `icon`.
     */
    poster?: string;
    posterAlt?: string;
    title: string | JSX.Element;
    subtitle?: string | JSX.Element;
    description?: string | JSX.Element;
    /**
     * Extra content rendered directly under the description, outside its
     * line clamp. Use it for meters or status rows that belong with the
     * description but must never be truncated.
     */
    descriptionExtra?: JSX.Element;
    footerLeft?: JSX.Element;
    footerRight?: JSX.Element;
    badge?: JSX.Element;
    interactive?: boolean;
    disabled?: boolean;
    /**
     * This card is the chosen one of a set of cards: its border takes the
     * primary color and assistive technology hears it pressed. Leave it
     * unset on cards that open something instead of choosing.
     */
    selected?: boolean;
    effect?: boolean;
    /**
     * Render icon images without the framed badge chrome (no background,
     * border, radius, or shadow) and slightly larger. Glyph icons are
     * unaffected — they never had a frame outside banners.
     */
    plainIcon?: boolean;
    /** When set, the card renders as an anchor and navigates. */
    href?: string;
    target?: JSX.AnchorHTMLAttributes<HTMLAnchorElement>["target"];
    rel?: string;
    onClick?: (e: MouseEvent) => void;
}

/** How many pictures tile a banner. */
const MOSAIC_MAX = 4;

const CONTROLS = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "summary",
    "[contenteditable]",
    "[tabindex]",
    ...["button", "link", "switch", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "textbox", "combobox"].map(
        (role) => `[role="${role}"]`,
    ),
].join(",");

export function PaperMediaCard(props: ParentProps<PaperMediaCardProps>) {
    const [local, rest] = splitProps(props, [
        "banner",
        "bannerAlt",
        "bannerHeight",
        "icon",
        "poster",
        "posterAlt",
        "title",
        "subtitle",
        "description",
        "descriptionExtra",
        "footerLeft",
        "footerRight",
        "badge",
        "interactive",
        "disabled",
        "selected",
        "effect",
        "plainIcon",
        "href",
        "target",
        "rel",
        "onClick",
        "class",
        "classList",
        "children",
    ]);

    const isInteractive = () =>
        !local.disabled && (local.interactive ?? Boolean(local.onClick || local.href));

    const isLink = () => Boolean(local.href);

    // each JSX prop is resolved once: reading one again would build it again
    const banner = children(() => local.banner as JSX.Element);
    const icon = children(() => local.icon);
    const title = children(() => local.title);
    const subtitle = children(() => local.subtitle);
    const description = children(() => local.description);
    const descriptionExtra = children(() => local.descriptionExtra);
    const badge = children(() => local.badge);
    const content = children(() => local.children);
    const footerLeft = children(() => local.footerLeft);
    const footerRight = children(() => local.footerRight);

    /** the addresses of a tiled banner; undefined for any other */
    const tiles = () => {
        const resolved = banner();
        return Array.isArray(resolved) && resolved.every((tile) => typeof tile === "string")
            ? (resolved as string[]).slice(0, MOSAIC_MAX)
            : undefined;
    };
    const hasBanner = () => (tiles() ? tiles()!.length > 0 : Boolean(banner()));
    const hasOverlappingIcon = () => hasBanner() && !local.poster && Boolean(icon());
    const hasOverlappingPoster = () => hasBanner() && Boolean(local.poster);

    // the whole card opens it, footer row included; a control inside it (a
    // button, a toggle, a field, a link) only does its own thing
    const onControl = (e: Event) => {
        if (!(e.target instanceof Element) || !(e.currentTarget instanceof Element)) return false;
        const control = e.target.closest(CONTROLS);
        return Boolean(control && control !== e.currentTarget && e.currentTarget.contains(control));
    };

    const handleClick = (e: MouseEvent) => {
        if (local.disabled) {
            e.preventDefault();
            return;
        }
        if (onControl(e)) return;
        local.onClick?.(e);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        // a key pressed on a control inside the card belongs to that control
        if (e.target !== e.currentTarget) return;
        if (isInteractive() && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            const target = e.currentTarget as HTMLElement | null;
            if (target) {
                const clickEvent = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                });
                target.dispatchEvent(clickEvent);
            }
        }
    };

    // an icon is a picture's address, a glyph name, or an element
    const renderIcon = (imageClass: string) => {
        const resolved = icon();
        if (typeof resolved !== "string") return resolved;
        if (resolved.startsWith("http") || resolved.startsWith("/") || resolved.startsWith("data:")) {
            return <img src={resolved} alt="" class={imageClass} />;
        }
        return <PaperIcon class={styles.iconGlyph}>{resolved}</PaperIcon>;
    };

    // built once: turning the press effect on or off moves this card into or
    // out of its wrapper, and never builds it again
    const card = (
        <Dynamic
            component={isLink() ? "a" : "div"}
            {...rest}
            href={local.href}
            target={local.target}
            rel={local.rel}
            role={!isLink() && isInteractive() ? "button" : undefined}
            tabIndex={!isLink() && isInteractive() ? 0 : undefined}
            aria-disabled={local.disabled ? true : undefined}
            aria-pressed={!isLink() && isInteractive() && local.selected !== undefined ? local.selected : undefined}
            onClick={handleClick}
            onKeyDown={isLink() ? undefined : handleKeyDown}
            class={cx(
                styles.card,
                isInteractive() ? styles.interactive : "",
                local.disabled ? styles.disabled : "",
                local.selected ? styles.selected : "",
                local.plainIcon ? styles.iconPlain : "",
                local.class,
            )}
            classList={local.classList}
        >
            <Show when={hasBanner()}>
                <div
                    class={styles.bannerContainer}
                    style={{
                        height: local.bannerHeight,
                    }}
                >
                    {tiles() ? (
                        <div class={styles.bannerMosaic} role="img" aria-label={local.bannerAlt}>
                            <For each={tiles()}>
                                {(src) => <img src={src} alt="" class={styles.bannerImage} loading="lazy" decoding="async" />}
                            </For>
                        </div>
                    ) : typeof banner() === "string" ? (
                        <img
                            src={banner() as string}
                            alt={local.bannerAlt || ""}
                            class={styles.bannerImage}
                            loading="lazy"
                            decoding="async"
                        />
                    ) : (
                        banner()
                    )}

                    <Show when={local.poster}>
                        <div class={styles.posterWrapper}>
                            <img src={local.poster} alt={local.posterAlt || ""} class={styles.posterImage} loading="lazy" decoding="async" />
                        </div>
                    </Show>

                    <Show when={!local.poster && icon()}>
                        <div class={styles.iconWrapper}>{renderIcon(styles.iconImage)}</div>
                    </Show>
                </div>
            </Show>

            <div
                class={cx(
                    styles.body,
                    hasOverlappingIcon()
                        ? styles.bodyWithOverlappingIcon
                        : "",
                    hasOverlappingPoster() ? styles.bodyBesidePoster : "",
                )}
            >
                <Show when={!hasBanner() && local.poster}>
                    <img src={local.poster} alt={local.posterAlt || ""} class={styles.posterStandalone} />
                </Show>

                <Show when={!hasBanner() && !local.poster && icon()}>
                    <div class={styles.iconStandaloneRow}>{renderIcon(styles.iconStandalone)}</div>
                </Show>

                <div class={styles.headerRow}>
                    <div class={styles.titleColumn}>
                        <PaperText size={4} weight={700} breakWord class={styles.title}>
                            {title()}
                        </PaperText>
                        <Show when={subtitle()}>
                            <PaperText size={1} color="text-subtle">
                                {subtitle()}
                            </PaperText>
                        </Show>
                    </div>

                    <Show when={badge()}>
                        <div class={styles.badge}>{badge()}</div>
                    </Show>
                </div>

                <Show when={description()}>
                    <PaperText size={2} class={styles.description}>
                        {description()}
                    </PaperText>
                </Show>

                <Show when={descriptionExtra()}>
                    <div class={styles.descriptionExtra}>{descriptionExtra()}</div>
                </Show>

                <Show when={content()}>
                    <div class={styles.contentArea}>{content()}</div>
                </Show>

                <Show when={Boolean(footerLeft()) || Boolean(footerRight())}>
                    <div class={styles.footer}>
                        <div class={styles.footerLeft}>{footerLeft()}</div>
                        <div class={styles.footerRight}>{footerRight()}</div>
                    </div>
                </Show>
            </div>
        </Dynamic>
    );

    return (
        <Show when={(local.effect ?? true) && isInteractive()} fallback={card}>
            <PaperEffect disabled={local.disabled} colorless class={styles.cardWrapper}>
                {card}
            </PaperEffect>
        </Show>
    );
}

export interface PaperMediaCardGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** Minimum card width before cards wrap to the next row, a size token. */
    minCardWidth?: PaperSize | (string & {});
}

export function PaperMediaCardGroup(props: ParentProps<PaperMediaCardGroupProps>) {
    const [local, rest] = splitProps(props, [
        "minCardWidth",
        "style",
        "class",
        "classList",
        "children",
    ]);

    return (
        <div
            {...rest}
            class={cx(styles.cardGroup, local.class)}
            classList={local.classList}
            style={mergeStyle(
                { "grid-template-columns": `repeat(auto-fill, minmax(${resolveSize(local.minCardWidth ?? "card-min")}, 1fr))` },
                local.style,
            )}
        >
            {local.children}
        </div>
    );
}
