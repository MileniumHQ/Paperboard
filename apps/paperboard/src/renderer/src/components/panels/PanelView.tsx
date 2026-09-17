import { PaperFlex, PaperText, PaperButton, getVarCss } from "@paperboard-dev/paperui";
import { type Component, createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, MAX_LIVE_IFRAMES } from "./panelLru";

export interface PanelViewProps {
    activePanel: string;
    activeComputerId: string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
    onReloadPanel?: (key: string) => void;
}

const PanelFrame: Component<{ panelKey: string; current: boolean; reload: number; retry: () => void }> = (props) => {
    const [computerId, panelId] = props.panelKey.split("::");
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
    createEffect(() => {
        const reload = props.reload;
        generation = crypto.randomUUID();
        setReady(false); setFailure("");
        if (frame) frame.src = `panel://${computerId}.${panelId}/?_r=${reload}&generation=${generation}`;
        const timer = setTimeout(() => setFailure("The panel did not finish connecting to its service."), 25_000);
        const receive = (event: MessageEvent) => {
            if (event.source !== frame?.contentWindow || event.data?.generation !== generation) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === panelId) {
                clearTimeout(timer); setReady(true); setFailure("");
            } else if (event.data.type === "paperboard:failed") {
                clearTimeout(timer); setFailure(String(event.data.message || "Panel initialization failed"));
            }
        };
        window.addEventListener("message", receive);
        onCleanup(() => { clearTimeout(timer); window.removeEventListener("message", receive); });
    });
    onMount(() => { if (frame) frame.src = `panel://${computerId}.${panelId}/?_r=${props.reload}&generation=${generation}`; });
    return <div style={{ position: "absolute", inset: "0", display: props.current ? "block" : "none" }}>
        <iframe ref={frame} data-panel-key={props.panelKey} title={panelId}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => frame?.contentWindow?.postMessage({ type: "paperboard:initialize", generation }, "*")}
            style={{ width: "100%", height: "100%", border: "none", "border-left": `${getVarCss("border-width")} solid ${getVarCss("border")}`, visibility: ready() && !failure() ? "visible" : "hidden" }} />
        <Show when={!ready() || failure()}><PaperFlex direction="column" center fullWidth fullHeight gap="half" style={{ position: "absolute", inset: "0" }}>
            <PaperText role="status">{failure() || "Connecting panel…"}</PaperText>
            <Show when={failure()}><PaperButton onClick={props.retry}>Reload panel</PaperButton></Show>
        </PaperFlex></Show>
    </div>;
};

const PanelView: Component<PanelViewProps> = (props) => {
    const [usageOrder, setUsageOrder] = createSignal<string[]>([]);
    const currentKey = () => `${props.activeComputerId}::${props.activePanel}`;
    createEffect(() => setUsageOrder((prev) => recordUse(prev, props.openedPanels, currentKey())));
    const live = () => liveKeys(props.openedPanels, usageOrder(), currentKey(), MAX_LIVE_IFRAMES);
    return <PaperFlex fullWidth fullHeight background="surface-raised" style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        <For each={props.openedPanels}>{(key) => <Show when={live().has(key)}>
            <PanelFrame panelKey={key} current={key === currentKey()} reload={props.reloadTokens?.[key] || 0} retry={() => props.onReloadPanel?.(key)} />
        </Show>}</For>
    </PaperFlex>;
};
export default PanelView;
