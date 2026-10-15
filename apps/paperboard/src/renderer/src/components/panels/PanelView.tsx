import { PaperFlex, getVarCss } from "@mileniumhq/paperui";
import { type Component, createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, MAX_LIVE_IFRAMES } from "./panelLru";
import LoadingOverlay from "./LoadingOverlay";
import { panelUrl } from "../../lib/shell";
import { FILE_TRANSFER_RESULT, parseFileTransferMessage, runPanelFileTransfer } from "../../lib/panelFileTransfer";
import BackupLocationChooser, { type BackupLocationChoice } from "../backups/BackupLocationChooser";
import { BACKUP_LOCATION_REQUEST, BACKUP_LOCATION_RESULT, parseBackupLocationRequest } from "../../lib/backupLocationRequest";

export type RestartState = { kind: "restarting" } | { kind: "failed"; message: string };

export interface PanelViewProps {
    activePanel: string;
    activeComputerId: string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
    onReloadPanel?: (key: string) => void;
    restartStates?: Record<string, RestartState>;
    onRestartPanel?: (key: string) => void;
}

const PanelFrame: Component<{ panelKey: string; current: boolean; reload: number; retry: () => void; restart?: RestartState; retryRestart: () => void }> = (props) => {
    const [computerId, panelId] = props.panelKey.split("::");
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
    // the backup location window this frame asked for, answered on it
    const [chooser, setChooser] = createSignal<{ requestId: string; generation: string; target: Window } | null>(null);
    createEffect(() => {
        const reload = props.reload;
        generation = crypto.randomUUID();
        const current = generation;
        setReady(false); setFailure("");
        if (frame) frame.src = panelUrl(computerId, panelId, `?_r=${reload}&generation=${generation}`);
        const timer = setTimeout(() => setFailure("The panel did not finish connecting to its service."), 25_000);
        const receive = (event: MessageEvent) => {
            if (event.source !== frame?.contentWindow || event.data?.generation !== generation) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === panelId) {
                clearTimeout(timer); setReady(true); setFailure("");
            } else if (event.data.type === "paperboard:failed") {
                clearTimeout(timer); setFailure(String(event.data.message || "Panel initialization failed"));
            } else if (event.data.type === BACKUP_LOCATION_REQUEST) {
                const target = frame?.contentWindow;
                const request = parseBackupLocationRequest(event.data, panelId, chooser() !== null);
                if (!target || !request) return;
                const answer = (result: BackupLocationChoice) =>
                    target.postMessage({ type: BACKUP_LOCATION_RESULT, generation: current, requestId: request.requestId, result }, "*");
                if (request.refused) answer({ status: "failed", message: request.refused });
                else setChooser({ requestId: request.requestId, generation: current, target });
            } else {
                // a save or open dialog, answered on the frame that asked
                const request = parseFileTransferMessage(event.data);
                const target = frame?.contentWindow;
                if (!request || !target) return;
                void runPanelFileTransfer(computerId, panelId, request).then((result) =>
                    target.postMessage({ type: FILE_TRANSFER_RESULT, generation: current, requestId: request.requestId, result }, "*"));
            }
        };
        window.addEventListener("message", receive);
        // a reloaded document asked nothing; its open window closes unanswered
        onCleanup(() => { clearTimeout(timer); window.removeEventListener("message", receive); setChooser(null); });
    });
    onMount(() => { if (frame) frame.src = panelUrl(computerId, panelId, `?_r=${props.reload}&generation=${generation}`); });
    return <div style={{ position: "absolute", inset: "0", visibility: props.current ? "visible" : "hidden", "pointer-events": props.current ? "auto" : "none" }}>
        <iframe ref={frame} data-panel-key={props.panelKey} title={panelId}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
            onLoad={() => frame?.contentWindow?.postMessage({ type: "paperboard:initialize", generation }, "*")}
            style={{ width: "100%", height: "100%", border: "none", "border-left": `${getVarCss("border-width")} solid ${getVarCss("border")}`, opacity: ready() && !failure() && !props.restart ? "1" : "0", "pointer-events": ready() && !failure() && !props.restart ? "auto" : "none" }} />
        <BackupLocationChooser computerId={computerId} panelId={panelId} open={chooser() !== null} onDone={(result) => {
            const request = chooser();
            setChooser(null);
            if (request && request.generation === generation) request.target.postMessage({ type: BACKUP_LOCATION_RESULT, generation: request.generation, requestId: request.requestId, result }, "*");
        }} />
        <Show when={props.restart}>{(restart) => (
            <LoadingOverlay
                label={restart().kind === "failed" ? undefined : "Restarting panel service…"}
                error={restart().kind === "failed" ? (restart() as { message: string }).message : undefined}
                retryLabel="Restart panel"
                onRetry={props.retryRestart}
            />
        )}</Show>
        <Show when={!props.restart && (!ready() || failure())}>
            <LoadingOverlay
                label={failure() ? undefined : "Connecting panel…"}
                error={failure() || undefined}
                retryLabel="Reload panel"
                onRetry={props.retry}
            />
        </Show>
    </div>;
};

const PanelView: Component<PanelViewProps> = (props) => {
    const [usageOrder, setUsageOrder] = createSignal<string[]>([]);
    const currentKey = () => `${props.activeComputerId}::${props.activePanel}`;
    createEffect(() => setUsageOrder((prev) => recordUse(prev, props.openedPanels, currentKey())));
    const live = () => liveKeys(props.openedPanels, usageOrder(), currentKey(), MAX_LIVE_IFRAMES);
    return <PaperFlex fullWidth fullHeight background="surface-raised" style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        <For each={props.openedPanels}>{(key) => <Show when={live().has(key)}>
            <PanelFrame panelKey={key} current={key === currentKey()} reload={props.reloadTokens?.[key] || 0} retry={() => props.onReloadPanel?.(key)}
                restart={props.restartStates?.[key]} retryRestart={() => props.onRestartPanel?.(key)} />
        </Show>}</For>
    </PaperFlex>;
};
export default PanelView;
