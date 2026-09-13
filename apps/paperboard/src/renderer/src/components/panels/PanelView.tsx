import { PaperFlex, PaperText, PaperButton, getVarCss } from "@paperboard-dev/paperui";
import { type Component, createEffect, createSignal, For, Show, onCleanup } from "solid-js";
import { recordUse, liveKeys, MAX_LIVE_IFRAMES } from "./panelLru";

export interface PanelViewProps {
    activePanel: string;
    activeComputerId: string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
    onReloadPanel?: (key: string) => void;
}

// how long an iframe gets to fire its load event before the tab is
// declared failed: long enough for a cold daemon + slow disk, short
// enough that the user is never left staring at a blank pane
const LOAD_TIMEOUT_MS = 20_000;

// Eviction is LRU on activation: evicted panels unmount (their state
// survives in daemon config, not in the DOM) and remount fresh on next
// open — reload-on-evict, no stale JS heap kept warm. The bound lives in
// panelLru.ts next to the policy so tests pin it.
const PanelView: Component<PanelViewProps> = (props) => {
    const [loadedPanels, setLoadedPanels] = createSignal<
        Record<string, boolean>
    >({});
    const [failedPanels, setFailedPanels] = createSignal<
        Record<string, boolean>
    >({});
    const [usageOrder, setUsageOrder] = createSignal<string[]>([]);

    const currentKey = () =>
        `${props.activeComputerId}::${props.activePanel}`;

    createEffect(() => {
        const key = currentKey();
        const opened = props.openedPanels;
        setUsageOrder((prev) => recordUse(prev, opened, key));
    });

    const live = () =>
        liveKeys(props.openedPanels, usageOrder(), currentKey(), MAX_LIVE_IFRAMES);

    const handleLoad = (key: string) => {
        setLoadedPanels((prev) => ({ ...prev, [key]: true }));
        setFailedPanels((prev) => ({ ...prev, [key]: false }));
    };

    // R6: onLoad is the ONLY success signal an iframe gives. A panel://
    // protocol error, a notify failure, or an uninstall-while-open means
    // load never fires — and the tab sat silently blank forever. A load
    // timeout per pending iframe demotes the tab to a visible failed
    // state with a reload affordance; a late load still wins (the
    // timeout is cancelled by handleLoad).
    createEffect(() => {
        const opened = props.openedPanels;
        const liveNow = live();
        const timers: ReturnType<typeof setTimeout>[] = [];
        for (const key of opened) {
            if (!liveNow.has(key)) continue;
            if (loadedPanels()[key] || failedPanels()[key]) continue;
            const timer = setTimeout(() => {
                setFailedPanels((prev) => ({ ...prev, [key]: true }));
            }, LOAD_TIMEOUT_MS);
            timers.push(timer);
        }
        onCleanup(() => {
            for (const t of timers) clearTimeout(t);
        });
    });

    const handleRetry = (key: string) => {
        setFailedPanels((prev) => ({ ...prev, [key]: false }));
        setLoadedPanels((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        // bump this panel's reload token so the iframe src changes and the
        // browser remounts it — the same reload path the context menu uses
        props.onReloadPanel?.(key);
    };

    return (
        <PaperFlex
            direction="column"
            fullWidth
            fullHeight
            background="frontest"
            style={{
                flex: "1",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <For each={props.openedPanels}>
                {(key) => {
                    const [frameCompId, panelId] = key.split("::");
                    // Read props inline; capturing them freezes stale values
                    // (Solid props are getters)
                    const isCurrent = () =>
                        frameCompId === props.activeComputerId &&
                        props.activePanel === panelId;
                    const isLoaded = () => Boolean(loadedPanels()[key]);
                    const isFailed = () => Boolean(failedPanels()[key]);
                    const reloadToken = () => props.reloadTokens?.[key] || 0;
                    // evicted panels render a placeholder: no iframe, no
                    // connection, no heap. Reopening remounts fresh.
                    const isLive = () => live().has(key);

                    return (
                        <Show
                            when={isLive() && !isFailed()}
                            fallback={
                                <Show
                                    when={isFailed()}
                                    fallback={
                                        <div data-panel-key={key} data-evicted="true" />
                                    }
                                >
                                    <PaperFlex
                                        data-panel-key={key}
                                        data-failed="true"
                                        direction="column"
                                        center
                                        fullWidth
                                        fullHeight
                                        gap="half"
                                    >
                                        <PaperText preset="body">
                                            This panel didn't load.
                                        </PaperText>
                                        <PaperButton
                                            variant="blue"
                                            onClick={() => handleRetry(key)}
                                        >
                                            Reload panel
                                        </PaperButton>
                                    </PaperFlex>
                                </Show>
                            }
                        >
                            <iframe
                                data-panel-key={key}
                                data-panel-id={panelId}
                                data-computer-id={frameCompId}
                                src={`panel://${frameCompId}.${panelId}/${reloadToken() ? `?_r=${reloadToken()}` : ""}`}
                                // Popups route through setWindowOpenHandler to the browser
                                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                onLoad={() => handleLoad(key)}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    position: "absolute",
                                    inset: "0",
                                    border: "none",
                                    "border-left": `${getVarCss("border-width")} solid ${getVarCss("medium-border")}`,
                                    "box-sizing": "border-box",
                                    display: isCurrent() ? "block" : "none",
                                    visibility: isLoaded() ? "visible" : "hidden",
                                }}
                                title={panelId}
                            />
                        </Show>
                    );
                }}
            </For>
        </PaperFlex>
    );
};

export default PanelView;
