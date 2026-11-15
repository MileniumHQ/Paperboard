import {
    type Component,
    createComputed,
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
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
    createRead,
} from "@mileniumhq/paperui";
import bannerImg from "./assets/PanelLibraryBanner.webp";
import styles from "./Library.module.css";
import type { LibraryBridge } from "./bridge";
import PanelPage, { iconGlyph, publisherLabel } from "./PanelPage";
import { createLibraryRoute } from "./router";
import { createInstalledMedia } from "./installedMedia";
import { withRegistryImages } from "./registryImage";
import {
    mergeRegistryWithInstalled,
    type PanelItem,
    type RegistryPanelRecord,
} from "../../../../packages/paperapi/src/panelMerge";
import { fetchRegistryJson } from "../../../../packages/paperapi/src/registryFetch";
import { waitForContentPainted } from "../../../../packages/paperapi/src/paintReady";

// The library runs on the registry origin, and the registry serves only the
// archive it hosts, so that is the one Download fetches.
function downloadArchive(panel: PanelItem) {
    const link = document.createElement("a");
    link.href = `/panel/${panel.id}/download`;
    link.download = `${panel.id}${panel.version ? `-${panel.version}` : ""}.tar.gz`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

export interface PanelLibraryAppProps {
    bridge: LibraryBridge;
}

const PanelLibraryApp: Component<PanelLibraryAppProps> = (props) => {
    // A reload is a retry for a library that is open but wrong: a transient
    // registry read that came back empty or malformed leaves the frame alive
    // with nothing to click, so the user is stuck until the app restarts.
    // A failed reload keeps whatever was rendered; the shell never sees an
    // empty library it would mistake for "nothing published".
    const read = createRead(async () => {
        // same-origin registry read: the library is a division of the
        // registry, so index.json is exactly the document it documents
        const data = await fetchRegistryJson("/panels/index.json");
        // an index is a map of panel id to record; anything else is not
        // an empty registry and must not be rendered as "nothing published"
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Panel registry index is not an object");
        }
        return data as Record<string, RegistryPanelRecord>;
    });
    const registry = () => read.value() ?? null;
    const loadFailed = () => read.error() !== null;
    const load = read.reload;
    // Registry settled is distinct from succeeded: a failed load is still
    // "settled" for readiness, because the library has something to show.
    const [registrySettled, setRegistrySettled] = createSignal(false);
    void read.ready().then(() => setRegistrySettled(true));
    const route = createLibraryRoute();
    // Install state is per panel: installs run side by side (the shell
    // answers each request on its own), and a failure stays on the page of
    // the panel that failed until that panel's next attempt.
    const [installs, setInstalls] = createStore<Record<string, { busy: boolean; error: string | null }>>({});

    const unrecognizedIds = createMemo(() => {
        const listed = registry();
        if (listed === null && !loadFailed()) return [];
        return props.bridge
            .installed()
            .map((panel) => panel.id)
            .filter((id) => !listed || !(id in listed));
    });

    const installedMedia = createInstalledMedia(props.bridge, unrecognizedIds, route.panelId);

    // The shell covers the frame until the library says it is done. Ready
    // means the registry has settled, no installed-panel media is still in
    // flight, and the rendered page has painted, so nothing shifts after
    // the reveal. Only an embedded library has a shell to tell, and a
    // handshake that lands after the timeout still makes it embedded.
    let readySent = false;
    createEffect(
        on([registrySettled, () => props.bridge.mode(), installedMedia.pending], ([settled, mode, pending]) => {
            if (readySent || !settled || mode !== "embedded" || pending > 0) return;
            readySent = true;
            void waitForContentPainted().then(() => props.bridge.notifyReady());
        }),
    );

    const merged = createMemo(() => {
        const media = installedMedia.media();
        return mergeRegistryWithInstalled(
            registry() ?? {},
            props.bridge.installed(),
            "",
        ).map((merged) => {
            const panel = withRegistryImages(merged);
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

    const selectedPanel = createMemo(
        () => panelList.find((p) => p.id === route.panelId()) ?? null,
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
                                                ? `The registry didn't answer: ${read.error()}`
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
                            <Show when={!loadFailed() && registry() !== null && panelList.length === 0}>
                                <PaperEmptyState
                                    icon="dashboard"
                                    title="No panels published yet"
                                    description="Panels published to this registry appear here."
                                />
                            </Show>

                            <PaperMediaCardGroup>
                                <For each={panelList}>
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
                        mediaError={installedMedia.errors()[panel().id] ?? null}
                        onNavigateHome={() => route.navigate(null)}
                        onAction={() => void handleAction(panel())}
                        onRetryMedia={() => installedMedia.retry(panel().id)}
                    />
                )}
            </Show>
        </PaperFlex>
    );
};

export default PanelLibraryApp;
