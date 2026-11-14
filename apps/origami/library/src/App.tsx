import {
    type Component,
    createComputed,
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onMount,
    Show,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperBadge,
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperPage,
    PaperText,
} from "@mileniumhq/paperui";
import bannerImg from "./assets/PanelLibraryBanner.webp";
import styles from "./Library.module.css";
import type { LibraryBridge } from "./bridge";
import PanelPage, { iconGlyph, publisherLabel } from "./PanelPage";
import { createLibraryRoute } from "./router";
import {
    mergeRegistryWithInstalled,
    type PanelItem,
    type RegistryPanelRecord,
} from "../../../../packages/paperapi/src/panelMerge";
import type { InstalledPanelMedia } from "../../../../packages/paperapi/src/storeListing";
import { fetchRegistryJson } from "../../../../packages/paperapi/src/registryFetch";
import { waitForContentPainted } from "../../../../packages/paperapi/src/paintReady";

// The library runs on the registry origin, so archive URLs resolve
// same-origin; the registry record's own downloadUrl stays authoritative
// when present.
function downloadArchive(panel: PanelItem) {
    const link = document.createElement("a");
    link.href = panel.downloadUrl || `/panel/${panel.id}/download`;
    link.download = `${panel.id}${panel.version ? `-${panel.version}` : ""}.tar.gz`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// what is cached per installed panel goes with the panel; nothing changed
// keeps the same object, so nothing downstream is notified
function onlyInstalled<T>(entries: Record<string, T>, installed: Set<string>): Record<string, T> {
    const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => installed.has(id)));
    return Object.keys(kept).length === Object.keys(entries).length ? entries : kept;
}

export interface PanelLibraryAppProps {
    bridge: LibraryBridge;
}

const PanelLibraryApp: Component<PanelLibraryAppProps> = (props) => {
    const [registry, setRegistry] = createSignal<Record<
        string,
        RegistryPanelRecord
    > | null>(null);
    const [loadFailed, setLoadFailed] = createSignal(false);
    const [loading, setLoading] = createSignal(false);
    // Registry settled is distinct from succeeded: a failed load is still
    // "settled" for readiness, because the library has something to show.
    const [registrySettled, setRegistrySettled] = createSignal(false);
    const [pendingMedia, setPendingMedia] = createSignal(0);
    const route = createLibraryRoute();
    // Install state is per panel: installs run side by side (the shell
    // answers each request on its own), and a failure stays on the page of
    // the panel that failed until that panel's next attempt.
    const [installs, setInstalls] = createStore<Record<string, { busy: boolean; error: string | null }>>({});

    // A reload is a retry for a library that is open but wrong: a transient
    // registry read that came back empty or malformed leaves the frame alive
    // with nothing to click, so the user is stuck until the app restarts.
    const load = async () => {
        if (loading()) return;
        setLoading(true);
        setLoadFailed(false);
        try {
            // same-origin registry read: the library is a division of the
            // registry, so index.json is exactly the document it documents
            const data = await fetchRegistryJson("/panels/index.json");
            // an index is a map of panel id to record; anything else is not
            // an empty registry and must not be rendered as "nothing published"
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error("Panel registry index is not an object");
            }
            setRegistry(data);
        } catch (err) {
            // A failed reload keeps whatever was rendered; the shell never
            // sees an empty library it would mistake for "nothing published".
            console.error("[library] registry unavailable:", err);
            setLoadFailed(true);
        } finally {
            setLoading(false);
            setRegistrySettled(true);
        }
    };

    onMount(() => {
        void load();
    });

    // Installed panels the registry doesn't list (dev links, direct
    // installs) describe themselves: Paperboard reads their own manifest and
    // store/ files. Icons are fetched for the grid; the full listing only
    // for the page being viewed. Entries live only while the panel stays
    // installed, so the cache is bounded by the installed set.
    const [localMedia, setLocalMedia] = createSignal<
        Record<string, InstalledPanelMedia & { full: boolean }>
    >({});
    const requestedMedia = new Set<string>();

    const unrecognizedIds = createMemo(() => {
        const listed = registry();
        if (listed === null && !loadFailed()) return [];
        return props.bridge
            .installed()
            .map((panel) => panel.id)
            .filter((id) => !listed || !(id in listed));
    });

    // a failed read is shown on the panel's page, never mistaken for a
    // panel with no listing; it stays until a read of it succeeds
    const [mediaErrors, setMediaErrors] = createSignal<Record<string, string>>({});
    const dropMediaError = (id: string) =>
        setMediaErrors((prev) => {
            if (!(id in prev)) return prev;
            const { [id]: _, ...rest } = prev;
            return rest;
        });

    const requestMedia = (id: string, full: boolean) => {
        const key = `${id}:${full ? "full" : "icon"}`;
        if (requestedMedia.has(key)) return;
        requestedMedia.add(key);
        setPendingMedia((count) => count + 1);
        void props.bridge
            .media(id, full)
            .then(
                (media) => {
                    if (!props.bridge.installed().some((panel) => panel.id === id)) return;
                    dropMediaError(id);
                    setLocalMedia((prev) => {
                        if (prev[id]?.full && !full) return prev;
                        return { ...prev, [id]: { ...media, full } };
                    });
                },
                (err: Error) => {
                    // unavailable, not empty: a retry asks again
                    requestedMedia.delete(key);
                    console.error(`[library] ${id}'s own listing is unavailable:`, err);
                    setMediaErrors((prev) => ({ ...prev, [id]: err.message }));
                },
            )
            .finally(() => setPendingMedia((count) => count - 1));
    };

    const retryMedia = (id: string) => {
        dropMediaError(id);
        requestMedia(id, true);
    };

    createEffect(
        on(
            [() => props.bridge.mode(), unrecognizedIds, () => props.bridge.installed(), route.panelId],
            ([mode, ids, installedList, selected]) => {
                if (mode !== "embedded") return;
                const installed = new Set(installedList.map((panel) => panel.id));
                setLocalMedia((prev) => onlyInstalled(prev, installed));
                setMediaErrors((prev) => onlyInstalled(prev, installed));
                for (const key of [...requestedMedia]) {
                    if (!installed.has(key.slice(0, key.lastIndexOf(":")))) requestedMedia.delete(key);
                }
                for (const id of ids) requestMedia(id, false);
                if (selected && ids.includes(selected)) requestMedia(selected, true);
            },
        ),
    );

    // The shell covers the frame until the library says it is done. Ready
    // means the registry has settled, no installed-panel media is still in
    // flight, and the rendered page has painted, so nothing shifts after
    // the reveal.
    let readySent = false;
    createEffect(
        on([registrySettled, () => props.bridge.mode(), pendingMedia], ([settled, mode, pending]) => {
            if (readySent || !settled || mode === "detecting" || pending > 0) return;
            readySent = true;
            void waitForContentPainted().then(() => props.bridge.notifyReady());
        }),
    );

    const merged = createMemo(() => {
        const media = localMedia();
        return mergeRegistryWithInstalled(
            registry() ?? {},
            props.bridge.installed(),
            "",
        ).map((panel) => {
            const own = media[panel.id];
            if (!own) return panel;
            return {
                ...panel,
                ...(own.icon ? { iconUrl: own.icon } : {}),
                ...(own.store ? { store: own.store } : {}),
            };
        });
    });
    // Every merge builds new records; reconciled by id, a panel keeps its
    // card (and its page keeps its screenshots) when the installed list or
    // its media arrive, and only what changed is redrawn.
    const [panelList, setPanelList] = createStore<PanelItem[]>([]);
    createComputed(() => setPanelList(reconcile(merged(), { key: "id" })));
    const panels = () => panelList;

    const selectedPanel = createMemo(
        () => panels().find((p) => p.id === route.panelId()) ?? null,
    );

    const handleAction = async (panel: PanelItem) => {
        if (panel.isInstalled && props.bridge.mode() === "embedded") {
            props.bridge.open(panel.id);
            return;
        }
        if (props.bridge.mode() !== "embedded") {
            downloadArchive(panel);
            return;
        }
        if (installs[panel.id]?.busy) return;
        setInstalls(panel.id, { busy: true, error: null });
        const result = await props.bridge.install(panel.id);
        setInstalls(panel.id, {
            busy: false,
            error: result.ok
                ? null
                : `Couldn't install ${panel.name}${result.error ? `: ${result.error}` : ""}`,
        });
    };

    // one scroll area, edge to edge, around either page's PaperPage column
    return (
        <PaperFlex direction="column" fullWidth fullHeight scrollable="y" overflowX="hidden">
            <Show
                when={selectedPanel()}
                fallback={
                    <PaperPage>
                        {/* a panel URL that doesn't resolve is its own page, never
                            the grid: loading, unavailable and unknown differ */}
                        <Show
                            when={!route.panelId()}
                            fallback={
                                <Show when={registry() !== null || loadFailed()}>
                                    <PaperEmptyState
                                        icon={loadFailed() ? "cloud_off" : "search_off"}
                                        title={loadFailed() ? "Couldn't load library" : "Panel not found"}
                                        description={
                                            loadFailed()
                                                ? "The registry didn't answer."
                                                : `No published panel is named ${route.panelId()}.`
                                        }
                                    >
                                        {loadFailed() ? (
                                            <PaperButton onClick={() => void load()}>Retry</PaperButton>
                                        ) : (
                                            <PaperButton onClick={() => route.navigate(null)}>
                                                Browse the library
                                            </PaperButton>
                                        )}
                                    </PaperEmptyState>
                                </Show>
                            }
                        >
                            <img
                                class={styles.banner}
                                src={bannerImg}
                                alt="Panel Library - Find and launch powerful tools in just a click"
                            />

                            <Show when={loadFailed()}>
                                <PaperFlex direction="row" gap="half" align="center">
                                    <PaperBadge variant="danger">Couldn't load library</PaperBadge>
                                    <PaperButton variant="text" onClick={() => void load()}>
                                        Retry
                                    </PaperButton>
                                </PaperFlex>
                            </Show>

                            {/* loaded and empty is a different fact from failed:
                                the registry answered, and it holds no panels */}
                            <Show when={!loadFailed() && registry() !== null && panels().length === 0}>
                                <PaperEmptyState
                                    icon="dashboard"
                                    title="No panels published yet"
                                    description="Panels published to this registry appear here."
                                />
                            </Show>

                            <PaperMediaCardGroup>
                                <For each={panels()}>
                                    {(panel) => (
                                        <PaperMediaCard
                                            icon={panel.iconUrl ?? iconGlyph(panel)}
                                            title={panel.name}
                                            description={panel.description}
                                            badge={
                                                panel.isInstalled ? (
                                                    // a quiet mark: most cards carry it,
                                                    // so it mustn't be the loudest thing on them
                                                    <PaperBadge variant="monochrome" icon="check">
                                                        Installed
                                                    </PaperBadge>
                                                ) : undefined
                                            }
                                            footerLeft={
                                                <PaperText size={2} color="text-subtle">
                                                    {publisherLabel(panel)}
                                                </PaperText>
                                            }
                                            footerRight={
                                                <PaperText size={2} color="text-subtle">
                                                    {panel.version ? `v${panel.version}` : "–"}
                                                </PaperText>
                                            }
                                            onClick={() => route.navigate(panel.id)}
                                        />
                                    )}
                                </For>
                            </PaperMediaCardGroup>
                        </Show>
                    </PaperPage>
                }
            >
                {(panel) => (
                    <PanelPage
                        panel={panel()}
                        mode={props.bridge.mode()}
                        busy={installs[panel().id]?.busy ?? false}
                        error={installs[panel().id]?.error ?? null}
                        mediaError={mediaErrors()[panel().id] ?? null}
                        onNavigateHome={() => route.navigate(null)}
                        onAction={() => void handleAction(panel())}
                        onRetryMedia={() => retryMedia(panel().id)}
                    />
                )}
            </Show>
        </PaperFlex>
    );
};

export default PanelLibraryApp;
