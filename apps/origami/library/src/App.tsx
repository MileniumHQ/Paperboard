import {
    type Component,
    createEffect,
    createMemo,
    createSignal,
    For,
    onMount,
    Show,
} from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperText,
    getVarCss,
} from "@paperboard-dev/paperui";
import bannerImg from "./assets/PanelLibraryBanner.png";
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

const rootStyle = {
    flex: "1",
    width: "100%",
    height: "100%",
    "overflow-y": "auto",
    "overflow-x": "hidden",
    "box-sizing": "border-box",
    padding: getVarCss("uigap"),
} as const;

const columnStyle = {
    "max-width": "62rem",
    margin: "0 auto",
    display: "flex",
    "flex-direction": "column",
    gap: getVarCss("uigap"),
    width: "100%",
    "box-sizing": "border-box",
} as const;

const PanelIcon: Component<{ panel: PanelItem; size: string }> = (props) => {
    return (
        <Show
            when={props.panel.iconUrl}
            fallback={
                <span style={{ "font-size": props.size }}>
                    {iconGlyph(props.panel)}
                </span>
            }
        >
            <img
                src={props.panel.iconUrl}
                alt=""
                style={{
                    width: props.size,
                    height: props.size,
                    "border-radius": getVarCss("border-radius"),
                    "object-fit": "contain",
                }}
            />
        </Show>
    );
};

export interface PanelLibraryAppProps {
    bridge: LibraryBridge;
}

const PanelLibraryApp: Component<PanelLibraryAppProps> = (props) => {
    const [registry, setRegistry] = createSignal<Record<
        string,
        RegistryPanelRecord
    > | null>(null);
    const [loadFailed, setLoadFailed] = createSignal(false);
    // Registry settled is distinct from succeeded: a failed load is still
    // "settled" for readiness, because the library has something to show.
    const [registrySettled, setRegistrySettled] = createSignal(false);
    const [pendingMedia, setPendingMedia] = createSignal(0);
    const route = createLibraryRoute();
    const [busyPanelId, setBusyPanelId] = createSignal<string | null>(null);
    const [installError, setInstallError] = createSignal<string | null>(null);

    const load = async () => {
        setLoadFailed(false);
        try {
            // same-origin registry read: the library is a division of the
            // registry, so index.json is exactly the document it documents
            setRegistry(await fetchRegistryJson("/panels/index.json"));
        } catch (err) {
            // A failed reload keeps whatever was rendered; the shell never
            // sees an empty library it would mistake for "nothing published".
            console.error("[library] registry unavailable:", err);
            setLoadFailed(true);
        } finally {
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

    const requestMedia = (id: string, full: boolean) => {
        const key = `${id}:${full ? "full" : "icon"}`;
        if (requestedMedia.has(key)) return;
        requestedMedia.add(key);
        setPendingMedia((count) => count + 1);
        void props.bridge.media(id, full).then((media) => {
            setPendingMedia((count) => Math.max(0, count - 1));
            if (!media) {
                // unavailable, not empty: allow a later visit to retry
                requestedMedia.delete(key);
                return;
            }
            if (!props.bridge.installed().some((panel) => panel.id === id)) return;
            setLocalMedia((prev) => {
                if (prev[id]?.full && !full) return prev;
                return { ...prev, [id]: { ...media, full } };
            });
        });
    };

    createEffect(() => {
        if (props.bridge.mode() !== "embedded") return;
        const ids = unrecognizedIds();
        const installed = new Set(props.bridge.installed().map((panel) => panel.id));
        setLocalMedia((prev) => {
            const kept = Object.fromEntries(
                Object.entries(prev).filter(([id]) => installed.has(id)),
            );
            return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
        });
        for (const key of [...requestedMedia]) {
            if (!installed.has(key.slice(0, key.lastIndexOf(":")))) requestedMedia.delete(key);
        }
        for (const id of ids) requestMedia(id, false);
        const selected = route.panelId();
        if (selected && ids.includes(selected)) requestMedia(selected, true);
    });

    // The shell covers the frame until the library says it is done. Ready
    // means the registry has settled, no installed-panel media is still in
    // flight, and the rendered page has painted, so nothing shifts after
    // the reveal.
    let readySent = false;
    createEffect(() => {
        if (readySent) return;
        const settled = registrySettled();
        const mode = props.bridge.mode();
        const pending = pendingMedia();
        // track the installed list so a late reply still re-checks readiness
        void props.bridge.installed();
        if (!settled || mode === "detecting" || pending > 0) return;
        readySent = true;
        void waitForContentPainted().then(() => props.bridge.notifyReady());
    });

    const panels = createMemo(() => {
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
        if (busyPanelId()) return;
        setBusyPanelId(panel.id);
        setInstallError(null);
        const result = await props.bridge.install(panel.id);
        setBusyPanelId(null);
        if (!result.ok) {
            setInstallError(
                `Couldn't install ${panel.name}${result.error ? `: ${result.error}` : ""}`,
            );
        }
    };

    return (
        <Show
            when={selectedPanel()}
            fallback={
                <div style={rootStyle}>
                    <div style={columnStyle}>
                    {/* a panel URL that doesn't resolve is its own page, never
                        the grid: loading, unavailable and unknown differ */}
                    <Show
                        when={!route.panelId()}
                        fallback={
                            <Show when={registry() !== null || loadFailed()}>
                                <PaperEmptyState
                                    icon={loadFailed() ? "cloud_off" : "search_off"}
                                    title={
                                        loadFailed()
                                            ? "Couldn't load library"
                                            : "Panel not found"
                                    }
                                    description={
                                        loadFailed()
                                            ? "The registry didn't answer."
                                            : `No published panel is named ${route.panelId()}.`
                                    }
                                >
                                    {loadFailed() ? (
                                        <PaperButton onClick={() => void load()}>
                                            Retry
                                        </PaperButton>
                                    ) : (
                                        <PaperButton onClick={() => route.navigate(null)}>
                                            Browse the library
                                        </PaperButton>
                                    )}
                                </PaperEmptyState>
                            </Show>
                        }
                    >
                        <div
                            style={{
                                width: "100%",
                                "border-radius": getVarCss("border-radius"),
                                overflow: "hidden",
                                "flex-shrink": 0,
                            }}
                        >
                            <img
                                src={bannerImg}
                                alt="Panel Library - Find and launch powerful tools in just a click"
                                style={{
                                    width: "100%",
                                    height: "auto",
                                    display: "block",
                                }}
                            />
                        </div>

                        <Show when={loadFailed()}>
                            <PaperFlex
                                direction="row"
                                gap="half"
                                align="center"
                            >
                                <PaperBadge variant="danger">
                                    Couldn't load library
                                </PaperBadge>
                                <PaperButton
                                    variant="text"
                                    onClick={() => void load()}
                                >
                                    Retry
                                </PaperButton>
                            </PaperFlex>
                        </Show>

                        {/* loaded and empty is a different fact from failed:
                            the registry answered, and it holds no panels */}
                        <Show
                            when={
                                !loadFailed() &&
                                registry() !== null &&
                                panels().length === 0
                            }
                        >
                            <PaperEmptyState
                                icon="dashboard"
                                title="No panels published yet"
                                description="Panels published to this registry appear here."
                            />
                        </Show>

                        <PaperMediaCardGroup minCardWidth="18rem">
                            <For each={panels()}>
                                {(panel) => (
                                    <PaperMediaCard
                                        icon={<PanelIcon panel={panel} size="4.5rem" />}
                                        title={panel.name}
                                        description={panel.description}
                                        badge={
                                            panel.isInstalled ? (
                                                <PaperBadge variant="success">
                                                    Installed
                                                </PaperBadge>
                                            ) : undefined
                                        }
                                        footerLeft={
                                            <PaperText
                                                size={2}
                                                color="text-subtle"
                                            >
                                                {publisherLabel(panel)}
                                            </PaperText>
                                        }
                                        footerRight={
                                            <PaperText
                                                size={2}
                                                color="text-subtle"
                                            >
                                                {panel.version
                                                    ? `v${panel.version}`
                                                    : "–"}
                                            </PaperText>
                                        }
                                        onClick={() => {
                                            setInstallError(null);
                                            route.navigate(panel.id);
                                        }}
                                    />
                                )}
                            </For>
                        </PaperMediaCardGroup>
                    </Show>
                    </div>
                </div>
            }
        >
            {(panel) => (
                <div style={rootStyle}>
                    <PanelPage
                        panel={panel()}
                        mode={props.bridge.mode()}
                        busy={busyPanelId() === panel().id}
                        error={installError()}
                        onNavigateHome={() => {
                            setInstallError(null);
                            route.navigate(null);
                        }}
                        onAction={() => void handleAction(panel())}
                    />
                </div>
            )}
        </Show>
    );
};

export default PanelLibraryApp;
