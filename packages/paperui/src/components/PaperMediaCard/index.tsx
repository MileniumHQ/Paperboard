import { getVarCss } from "../../utils/theme";
import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperText } from "../PaperText";
import { PaperIcon } from "../PaperIcon";
import { PaperEffect } from "../PaperEffect";

export interface PaperMediaCardProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "onClick"> {
    banner?: string | JSX.Element;
    bannerAlt?: string;
    bannerHeight?: string;
    icon?: string | JSX.Element;
    title: string | JSX.Element;
    subtitle?: string | JSX.Element;
    description?: string | JSX.Element;
    footerLeft?: JSX.Element;
    footerRight?: JSX.Element;
    badge?: JSX.Element;
    interactive?: boolean;
    disabled?: boolean;
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

export function PaperMediaCard(props: ParentProps<PaperMediaCardProps>) {
    const [local, rest] = splitProps(props, [
        "banner",
        "bannerAlt",
        "bannerHeight",
        "icon",
        "title",
        "subtitle",
        "description",
        "footerLeft",
        "footerRight",
        "badge",
        "interactive",
        "disabled",
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

    const hasBanner = () => Boolean(local.banner);
    const hasOverlappingIcon = () => hasBanner() && Boolean(local.icon);

    const handleClick = (e: MouseEvent) => {
        if (local.disabled) {
            e.preventDefault();
            return;
        }
        local.onClick?.(e);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
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

    const cardContent = () => (
        <Dynamic
            component={isLink() ? "a" : "div"}
            {...rest}
            href={local.href}
            target={local.target}
            rel={local.rel}
            role={!isLink() && isInteractive() ? "button" : undefined}
            tabIndex={!isLink() && isInteractive() ? 0 : undefined}
            aria-disabled={local.disabled ? true : undefined}
            onClick={handleClick}
            onKeyDown={isLink() ? undefined : handleKeyDown}
            class={[
                styles.card,
                isInteractive() ? styles.interactive : "",
                local.disabled ? styles.disabled : "",
                local.plainIcon ? styles.iconPlain : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <Show when={hasBanner()}>
                <div
                    class={styles.bannerContainer}
                    style={{
                        height: local.bannerHeight,
                    }}
                >
                    {typeof local.banner === "string" ? (
                        <img
                            src={local.banner}
                            alt={local.bannerAlt || ""}
                            class={styles.bannerImage}
                        />
                    ) : (
                        local.banner
                    )}

                    <Show when={local.icon}>
                        <div class={styles.iconWrapper}>
                            {typeof local.icon === "string" ? (
                                local.icon.startsWith("http") ||
                                local.icon.startsWith("/") ||
                                local.icon.startsWith("data:") ? (
                                    <img
                                        src={local.icon}
                                        alt=""
                                        class={styles.iconImage}
                                    />
                                ) : (
                                    <PaperIcon class={styles.iconGlyph}>
                                        {local.icon}
                                    </PaperIcon>
                                )
                            ) : (
                                local.icon
                            )}
                        </div>
                    </Show>
                </div>
            </Show>

            <div
                class={[
                    styles.body,
                    hasOverlappingIcon()
                        ? styles.bodyWithOverlappingIcon
                        : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <Show when={!hasBanner() && local.icon}>
                    <div style={{ "margin-bottom": `${getVarCss("uigap-half")}` }}>
                        {typeof local.icon === "string" ? (
                            local.icon.startsWith("http") ||
                            local.icon.startsWith("/") ||
                            local.icon.startsWith("data:") ? (
                                <img
                                    src={local.icon}
                                    alt=""
                                    class={styles.iconStandalone}
                                />
                            ) : (
                                <PaperIcon class={styles.iconGlyph}>
                                    {local.icon}
                                </PaperIcon>
                            )
                        ) : (
                            local.icon
                        )}
                    </div>
                </Show>

                <div class={styles.headerRow}>
                    <div class={styles.titleColumn}>
                        <PaperText size={4} weight={700} class={styles.title}>
                            {local.title}
                        </PaperText>
                        <Show when={local.subtitle}>
                            <PaperText size={1} color="text-subtle">
                                {local.subtitle}
                            </PaperText>
                        </Show>
                    </div>

                    <Show when={local.badge}>
                        <div style={{ "flex-shrink": 0 }}>{local.badge}</div>
                    </Show>
                </div>

                <Show when={local.description}>
                    <PaperText size={2} class={styles.description}>
                        {local.description}
                    </PaperText>
                </Show>

                <Show when={local.children}>
                    <div class={styles.contentArea}>{local.children}</div>
                </Show>

                <Show when={Boolean(local.footerLeft) || Boolean(local.footerRight)}>
                    <div class={styles.footer}>
                        <div class={styles.footerLeft}>{local.footerLeft}</div>
                        <div class={styles.footerRight}>
                            {local.footerRight}
                        </div>
                    </div>
                </Show>
            </div>
        </Dynamic>
    );

    return (
        <Show
            when={(local.effect ?? true) && isInteractive()}
            fallback={cardContent()}
        >
            <PaperEffect
                disabled={local.disabled}
                colorless
                class={styles.cardWrapper}
            >
                {cardContent()}
            </PaperEffect>
        </Show>
    );
}

export interface PaperMediaCardGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** Minimum card width before cards wrap to the next row. */
    minCardWidth?: string;
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
            class={[styles.cardGroup, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            style={{
                "grid-template-columns": `repeat(auto-fill, minmax(${local.minCardWidth ?? `${getVarCss("size-card-min")}`}, 1fr))`,
                ...(typeof local.style === "object" ? local.style : {}),
            }}
        >
            {local.children}
        </div>
    );
}
