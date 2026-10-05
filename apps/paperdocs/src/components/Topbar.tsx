import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperIcon,
    PaperSpacer,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";
import {
    createEffect,
    createSignal,
    For,
    onCleanup,
    Show,
    type JSX,
} from "solid-js";
import { metaSections } from "../docs/meta";
import { docsPath, withBase } from "../utils/base";
import { styledText } from "../site/landing/TextEffect";
import {
    BRAND,
    DOCS_LINKS,
    DOWNLOAD,
    LEARN_LINKS,
    SITE_LINKS,
} from "../site/links";

interface TopbarProps {
    /** "docs" shows the search slot and the PaperDocs brand; "site" (the
        default) shows the Paperboard brand and the Download action. */
    variant?: "docs" | "site";
    theme?: "dark" | "light";
    toggleTheme?: () => void;
    section?: string;
    /** Docs-only slot; the site pages leave it empty so the search index is
        not pulled into the site bundle. */
    search?: JSX.Element;
}

// One topbar for the docs pages and the prerendered root pages. The brand
// follows the section prop: a section page is "<Section> docs". Without a
// section the docs variant keeps its PaperDocs brand, while the site variant
// shows the site brand. The actions differ by variant: the site adds a
// Download link. Menus are PaperContextMenu in both; the static pages render
// the chrome client-side.
export function Topbar(props: TopbarProps) {
    const docsMenu = useContextMenuState();
    const learnMenu = useContextMenuState();
    const [mobileOpen, setMobileOpen] = createSignal(false);
    const isSite = () => props.variant !== "docs";

    // The mobile panel is a plain disclosure, not a portalled menu, so it
    // matches the landing. Close it on Escape or a click outside.
    createEffect(() => {
        if (!mobileOpen()) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMobileOpen(false);
        };
        const onPointerDown = (event: Event) => {
            const target = event.target as HTMLElement | null;
            if (
                target?.closest(
                    ".topbar-mobile-panel, .topbar-menu-button",
                )
            ) {
                return;
            }
            setMobileOpen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("pointerdown", onPointerDown);
        onCleanup(() => {
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("pointerdown", onPointerDown);
        });
    });

    const sectionMeta = () =>
        props.section ? metaSections[props.section] : undefined;

    const brandHref = () =>
        sectionMeta() ? docsPath(props.section!) : "/";
    const brandImage = () =>
        withBase(
            sectionMeta()
                ? `/${props.section}.png`
                : isSite()
                  ? BRAND.logo
                  : "/paperdocs.png",
        );
    const brandName = () =>
        sectionMeta()?.name || (isSite() ? BRAND.name : "PaperDocs");
    // The site brand is the "Paperboard" wordmark, textured like the
    // marketing headers. Docs and section brands stay plain PaperUI text.
    const isWordmark = () => isSite() && !sectionMeta();

    return (
        <>
            <PaperFlex
                direction="row"
                gap="double"
                class="topbar"
                align="center"
            >
                <a class="topbar-brand" href={brandHref()}>
                    <img src={brandImage()} class="logo" />
                    <Show
                        when={isWordmark()}
                        fallback={
                            <PaperText rounded weight={800} size={5}>
                                {brandName()}{" "}
                                <Show when={sectionMeta()}>
                                    <PaperText weight={600}>docs</PaperText>
                                </Show>
                            </PaperText>
                        }
                    >
                        <span class="paper-wordmark">
                            <span class="paper-wordmark-label">Paperboard</span>
                            <span
                                class="styled-text-host"
                                aria-hidden="true"
                                innerHTML={styledText("Paperboard", 20)}
                            />
                        </span>
                    </Show>
                </a>
                <PaperFlex gap="half" direction="row" class="topbar-links">
                    <PaperButton
                        variant="text"
                        size="tiny"
                        onClick={(e) => learnMenu.openBelow(e)}
                    >
                        Learn <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton
                        variant="text"
                        size="tiny"
                        onClick={(e) => docsMenu.openBelow(e)}
                    >
                        Docs <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton variant="text" size="tiny" href="/blog">
                        Blog
                    </PaperButton>
                </PaperFlex>
                <PaperSpacer></PaperSpacer>
                <PaperFlex
                    direction="row"
                    align="center"
                    gap="threefourths"
                    class="topbar-actions"
                >
                    <PaperButton
                        icon
                        variant="text"
                        size="tiny"
                        class="topbar-menu-button"
                        aria-label="Open navigation"
                        aria-expanded={mobileOpen()}
                        onClick={() => setMobileOpen((open) => !open)}
                    >
                        <PaperIcon zeroHeight>
                            {mobileOpen() ? "close" : "menu"}
                        </PaperIcon>
                    </PaperButton>
                    <Show when={isSite()}>
                        <PaperButton
                            class="topbar-download"
                            variant="text"
                            size="tiny"
                            href={DOWNLOAD.href}
                        >
                            {DOWNLOAD.label}
                        </PaperButton>
                    </Show>
                    <Show when={props.search}>{props.search}</Show>
                    <PaperButton
                        icon
                        variant="text"
                        size="tiny"
                        onClick={() => props.toggleTheme?.()}
                    >
                        {props.theme === "dark" ? "dark_mode" : "light_mode"}
                    </PaperButton>
                </PaperFlex>

                {/* Small screens hide the inline links, so this panel carries
                    the same destinations as the landing's mobile menu: plain
                    links, no icons or descriptions. It is a child of the
                    topbar so it floats below the bar instead of pushing the
                    page down. */}
                <Show when={mobileOpen()}>
                    <nav class="topbar-mobile-panel" aria-label="Mobile">
                        <span class="topbar-mobile-heading">Learn</span>
                        <For each={LEARN_LINKS}>
                            {(link) => (
                                <a class="topbar-mobile-link" href={link.href}>
                                    {link.label}
                                </a>
                            )}
                        </For>
                        <span class="topbar-mobile-heading">Docs</span>
                        <For each={DOCS_LINKS}>
                            {(link) => (
                                <a class="topbar-mobile-link" href={link.href}>
                                    {link.label}
                                </a>
                            )}
                        </For>
                        <span class="topbar-mobile-heading">Site</span>
                        <For each={SITE_LINKS}>
                            {(link) => (
                                <a class="topbar-mobile-link" href={link.href}>
                                    {link.label}
                                </a>
                            )}
                        </For>
                    </nav>
                </Show>
            </PaperFlex>

            <PaperContextMenu
                open={learnMenu.isOpen()}
                target={learnMenu.target()}
                placement={learnMenu.placement()}
                onClose={learnMenu.close}
            >
                <For each={LEARN_LINKS}>
                    {(link) => (
                        <PaperContextMenuItem
                            icon={<PaperIcon src={withBase(link.image)} />}
                            description={link.description}
                            onClick={() => {
                                learnMenu.close();
                                window.location.href = link.href;
                            }}
                        >
                            {link.label}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>

            <PaperContextMenu
                open={docsMenu.isOpen()}
                target={docsMenu.target()}
                placement={docsMenu.placement()}
                onClose={docsMenu.close}
            >
                <For each={DOCS_LINKS}>
                    {(link) => (
                        <PaperContextMenuItem
                            icon={
                                link.image ? (
                                    <PaperIcon src={withBase(link.image)} />
                                ) : (
                                    <PaperIcon>
                                        {link.icon || "description"}
                                    </PaperIcon>
                                )
                            }
                            description={link.description}
                            onClick={() => {
                                docsMenu.close();
                                window.location.href = link.href;
                            }}
                        >
                            {link.label}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>
        </>
    );
}
