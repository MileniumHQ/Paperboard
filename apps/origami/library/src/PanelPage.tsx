import {
    type Component,
    createSignal,
    For,
    type JSX,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperIcon,
    PaperMarkdown,
    PaperText,
} from "@paperboard-dev/paperui";
import type { PanelItem } from "../../../../packages/paperapi/src/panelMerge";
import type { StoreRow, StoreScreenshot } from "../../../../packages/paperapi/src/storeListing";
import type { LibraryMode } from "./bridge";
import { panelHref } from "./router";
import styles from "./PanelPage.module.css";

// Publisher and install source are independent facts; an unknown publisher
// stays explicitly unknown rather than borrowing the registry's name.
export function publisherLabel(panel: PanelItem): string {
    return panel.publisher || "Publisher not provided";
}

/** Archive size in the units a person reads: KB under a megabyte, MB above. */
export function formatBytes(bytes: number | undefined): string | null {
    if (bytes === undefined) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A manifest icon path ("branding/icon.png") is a daemon-served asset the
// library origin cannot address; it falls back to the glyph rather than
// rendering the path as text.
export function iconGlyph(panel: PanelItem): string {
    const icon = panel.icon;
    if (icon && !icon.includes(".") && !icon.includes("/")) return icon;
    return "dashboard";
}

export type PanelAction = "open" | "install" | "download" | "busy" | "detecting";

export function panelAction(
    panel: PanelItem,
    mode: LibraryMode,
    busy: boolean,
): PanelAction {
    if (busy) return "busy";
    if (mode === "detecting") return "detecting";
    if (mode === "embedded") return panel.isInstalled ? "open" : "install";
    return "download";
}

const ACTION_LABEL: Record<PanelAction, string> = {
    open: "Open",
    install: "Install",
    download: "Download",
    busy: "Installing…",
    detecting: "Checking…",
};

const ACTION_ICON: Record<PanelAction, string> = {
    open: "open_in_new",
    install: "install_desktop",
    download: "download",
    busy: "progress_activity",
    detecting: "progress_activity",
};

const InfoCard: Component<{
    icon: string;
    title: string;
    subtitle: string;
    rows: StoreRow[];
}> = (
    props,
) => (
    <Show when={props.rows.length > 0}>
        <PaperCard class={styles.card} padding="sixfourths" gap="half">
            <div class={styles.cardHeader}>
                <PaperIcon class={styles.cardIcon} aria-hidden="true">
                    {props.icon}
                </PaperIcon>
                <PaperText as="h3" size={4} weight={800} rounded>
                    {props.title}
                </PaperText>
                <PaperText size={2} color="text-subtle">
                    {props.subtitle}
                </PaperText>
            </div>
            <table class={styles.rows}>
                <tbody>
                    <For each={props.rows}>
                        {(row) => (
                            <tr>
                                <th scope="row">{row.name}</th>
                                <td>{row.detail}</td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </table>
        </PaperCard>
    </Show>
);

// One frame at a time behind arrow buttons; the arrows disable at either end
// so the row never pretends there is more to see.
const Screenshots: Component<{ panelName: string; shots: StoreScreenshot[] }> = (props) => {
    let track: HTMLDivElement | undefined;
    const [atStart, setAtStart] = createSignal(true);
    const [atEnd, setAtEnd] = createSignal(props.shots.length <= 1);

    const sync = () => {
        if (!track) return;
        setAtStart(track.scrollLeft <= 1);
        setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
    };
    const step = (direction: 1 | -1) => {
        if (!track) return;
        const frame = track.firstElementChild as HTMLElement | null;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        track.scrollBy({ left: direction * ((frame?.offsetWidth ?? track.clientWidth) + gap), behavior: "smooth" });
    };

    onMount(() => {
        sync();
        // frame width changes move the ends; without ResizeObserver
        // (non-browser hosts) window resizes are the only width change
        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", sync);
            onCleanup(() => window.removeEventListener("resize", sync));
            return;
        }
        const observer = new ResizeObserver(sync);
        if (track) observer.observe(track);
        onCleanup(() => observer.disconnect());
    });

    return (
        <section class={styles.gallery} aria-label="Screenshots">
            <PaperButton
                class={styles.arrow}
                icon
                variant="text"
                aria-label="Previous screenshot"
                disabled={atStart()}
                onClick={() => step(-1)}
            >
                <PaperIcon aria-hidden="true">chevron_left</PaperIcon>
            </PaperButton>
            <div class={styles.shots} ref={track} onScroll={sync}>
                <For each={props.shots}>
                    {(shot, index) => {
                        const alt = shot.alt ?? `${props.panelName} screenshot ${index() + 1}`;
                        return (
                            <div class={styles.shot}>
                                <img
                                    class={shot.dark ? styles.onlyLight : undefined}
                                    src={shot.light}
                                    alt={alt}
                                    loading="lazy"
                                />
                                <Show when={shot.dark}>
                                    <img class={styles.onlyDark} src={shot.dark} alt={alt} loading="lazy" />
                                </Show>
                            </div>
                        );
                    }}
                </For>
            </div>
            <PaperButton
                class={styles.arrow}
                icon
                variant="text"
                aria-label="Next screenshot"
                disabled={atEnd()}
                onClick={() => step(1)}
            >
                <PaperIcon aria-hidden="true">chevron_right</PaperIcon>
            </PaperButton>
        </section>
    );
};

const Fact: Component<{ label: string; children: JSX.Element }> = (props) => (
    <div class={styles.fact}>
        <span class={styles.factLabel}>{props.label}</span>
        <span class={styles.factValue}>{props.children}</span>
    </div>
);

export interface PanelPageProps {
    panel: PanelItem;
    mode: LibraryMode;
    busy: boolean;
    error: string | null;
    onAction: () => void;
    onNavigateHome: () => void;
}

const PanelPage: Component<PanelPageProps> = (props) => {
    const action = () => panelAction(props.panel, props.mode, props.busy);
    const store = () => props.panel.store;
    const size = () => formatBytes(props.panel.archiveBytes);

    return (
        <article class={styles.page} aria-label={props.panel.name}>
            <nav class={styles.crumbs} aria-label="Breadcrumb">
                <a
                    class={styles.crumbLink}
                    href={panelHref(null)}
                    onClick={(event) => {
                        // plain left click stays in-page; modified clicks
                        // (new tab, new window) keep the browser's behavior
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
                        event.preventDefault();
                        props.onNavigateHome();
                    }}
                >
                    <PaperIcon aria-hidden="true">chevron_left</PaperIcon>
                    Library
                </a>
            </nav>

            <header class={styles.hero}>
                <Show
                    when={props.panel.iconUrl}
                    fallback={
                        <PaperIcon class={styles.heroGlyph} aria-hidden="true">
                            {iconGlyph(props.panel)}
                        </PaperIcon>
                    }
                >
                    <img class={styles.heroIcon} src={props.panel.iconUrl} alt="" />
                </Show>
                <div class={styles.heroText}>
                    <PaperText as="h1" class={styles.title} size={12} weight={800} rounded>
                        {props.panel.name}
                    </PaperText>
                    <PaperText size={4} color="text-subtle">
                        {props.panel.description || "No description provided for this panel."}
                    </PaperText>
                </div>
                <div class={styles.heroAction}>
                    <PaperEffect>
                    <PaperButton
                        class={styles.actionButton}
                        size="large"
                        variant={action() === "open" ? "brand" : "primary"}
                        disabled={action() === "busy" || action() === "detecting"}
                        onClick={props.onAction}
                    >
                        <PaperIcon aria-hidden="true">{ACTION_ICON[action()]}</PaperIcon>
                        {ACTION_LABEL[action()]}
                    </PaperButton>
                    </PaperEffect>
                    <Show when={props.error}>
                        <PaperText size={2} color="danger" role="alert">
                            {props.error}
                        </PaperText>
                    </Show>
                </div>
            </header>

            <section class={styles.facts} aria-label="Details">
                <Fact label="Publisher">{publisherLabel(props.panel)}</Fact>
                <Fact label="Size">{size() ?? "Unknown"}</Fact>
                <Fact label={props.panel.isInstalled ? "Installed" : "Version"}>
                    {props.panel.version ? `v${props.panel.version}` : "Unknown"}
                </Fact>
                {/* installed panels report their own manifest's version; the
                    registry's newest release is a separate fact */}
                <Show
                    when={
                        props.panel.isInstalled &&
                        props.panel.latestVersion &&
                        props.panel.latestVersion !== props.panel.version
                    }
                >
                    <Fact label="Latest">v{props.panel.latestVersion}</Fact>
                </Show>
            </section>

            <Show when={store()?.screenshots.length}>
                <Screenshots panelName={props.panel.name} shots={store()!.screenshots} />
            </Show>

            <Show when={store()?.about}>
                {(about) => (
                    <section aria-label="About">
                        <PaperMarkdown text={about()} />
                    </section>
                )}
            </Show>

            <Show
                when={
                    store() &&
                    (store()!.services.length ||
                        store()!.credits.length ||
                        store()!.requirements.length)
                }
            >
                <section class={styles.cards} aria-label="More information">
                    <InfoCard icon="public" title="Services used"
                        subtitle="Services that this panel contacts."
                        rows={store()!.services} />
                    <InfoCard icon="favorite" title="Special thanks"
                        subtitle="Projects that make this panel possible."
                        rows={store()!.credits} />
                    <InfoCard
                        icon="memory"
                        title="Recommended system"
                        subtitle="Recommended minimum system specs."
                        rows={store()!.requirements}
                    />
                </section>
            </Show>
        </article>
    );
};

export default PanelPage;
