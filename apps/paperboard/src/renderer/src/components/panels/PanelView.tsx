import { PaperFlex, playHaptic, swipeFromFrame } from "@mileniumhq/paperui";
import { backupApi, backupProgressFraction, backupProgressText, HAPTIC_MESSAGE, SWIPE_BACK_MESSAGE, type BackupProgress } from "@mileniumhq/paperapi";
import { type Component, createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, recordAway, withoutIdle, MAX_LIVE_IFRAMES, IDLE_UNLOAD_MS } from "./panelLru";
import LoadingOverlay from "./LoadingOverlay";
import styles from "./frame.module.css";
import { panelUrl } from "../../lib/shell";
import { FILE_TRANSFER_RESULT, parseFileTransferMessage, runPanelFileTransfer } from "../../lib/panelFileTransfer";
import { createFrameLoopbackRedirects, LOOPBACK_REDIRECT_CANCEL, LOOPBACK_REDIRECT_REQUEST, LOOPBACK_REDIRECT_RESULT, parseLoopbackRedirectMessage } from "../../lib/panelLoopbackRedirect";
import BackupLocationChooser, { type BackupLocationChoice } from "../backups/BackupLocationChooser";
import { BACKUP_LOCATION_REQUEST, BACKUP_LOCATION_RESULT, parseBackupLocationRequest } from "../../lib/backupLocationRequest";

// restarting: the panel's service restarts; updating: a new release of the panel installs
export type RestartState = { kind: "restarting" } | { kind: "updating" } | { kind: "failed"; message: string };

export interface PanelViewProps {
    activePanel: string;
    activeComputerId: string;
    /** what the shell calls each computer; a panel is told its own */
    computerName: (computerId: string) => string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
    onReloadPanel?: (key: string) => void;
    restartStates?: Record<string, RestartState>;
    onRestartPanel?: (key: string) => void;
}

const PanelFrame: Component<{ panelKey: string; computerName: string; current: boolean; reload: number; retry: () => void; restart?: RestartState; retryRestart: () => void }> = (props) => {
    const [computerId, panelId] = props.panelKey.split("::");
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
    // A backup or restore stops the panel's service while it copies or swaps
    // the data. The frame says so, with how far along it is, instead of
    // failing to reach the service; by source ("" = the panel's own data).
    const [backups, setBackups] = createSignal<Record<string, BackupProgress>>({});
    const held = () => Object.values(backups()).find((p) => p.servicePaused) ?? null;
    const refreshBackups = () => backupApi.progress(panelId, computerId).then(
        (list) => setBackups(Object.fromEntries(list.map((p) => [p.sourceId ?? "", p]))),
        (err) => console.error(`[panels] could not read ${panelId}'s running backups:`, err),
    );
    onMount(() => {
        const off = backupApi.onProgress(panelId, (change) => setBackups((prev) => {
            const next = { ...prev };
            if (change.progress) next[change.sourceId ?? ""] = change.progress;
            else delete next[change.sourceId ?? ""];
            return next;
        }), computerId);
        onCleanup(off);
        void refreshBackups();
    });
    // a socket that dropped meanwhile misses the end: look again while held
    createEffect(() => {
        if (!held()) return;
        const timer = setInterval(() => void refreshBackups(), 5_000);
        onCleanup(() => clearInterval(timer));
    });
    // the service is back: a page that lost it while held loads again
    let wasHeld = false;
    createEffect(() => {
        const now = held() !== null;
        if (wasHeld && !now && (failure() || !ready())) props.retry();
        wasHeld = now;
    });
    // the backup location window this frame asked for, answered on it
    const [chooser, setChooser] = createSignal<{ requestId: string; sourceId?: string; generation: string; target: Window } | null>(null);
    createEffect(() => {
        const reload = props.reload;
        generation = crypto.randomUUID();
        const current = generation;
        setReady(false); setFailure("");
        if (frame) frame.src = panelUrl(computerId, panelId, `?_r=${reload}&generation=${generation}`);
        const timer = setTimeout(() => setFailure("The panel did not finish connecting to its service."), 25_000);
        // a sign-in redirect this document asked the shell to catch
        const loopback = createFrameLoopbackRedirects(computerId);
        const receive = (event: MessageEvent) => {
            if (event.source !== frame?.contentWindow || event.data?.generation !== generation) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === panelId) {
                clearTimeout(timer); setReady(true); setFailure("");
            } else if (event.data.type === "paperboard:failed") {
                clearTimeout(timer);
                // a backup that just stopped the service explains the failure
                const message = String(event.data.message || "Panel initialization failed");
                void refreshBackups().then(() => { if (generation === current) setFailure(message); });
            } else if (event.data.type === SWIPE_BACK_MESSAGE) {
                // the panel's list had no page to go back from: this frame's page goes back
                if (frame && props.current) swipeFromFrame(frame, event.data);
            } else if (event.data.type === HAPTIC_MESSAGE) {
                // frames can't vibrate; the shell plays it, if it is a kind it knows
                if (props.current) playHaptic(event.data.kind);
            } else if (event.data.type === BACKUP_LOCATION_REQUEST) {
                const target = frame?.contentWindow;
                const request = parseBackupLocationRequest(event.data, panelId, chooser() !== null);
                if (!target || !request) return;
                const answer = (result: BackupLocationChoice) => {
                    target.postMessage({ type: BACKUP_LOCATION_RESULT, generation: current, requestId: request.requestId, result }, "*");
                };
                if (request.refused) answer({ status: "failed", message: request.refused });
                else setChooser({ requestId: request.requestId, sourceId: request.sourceId, generation: current, target });
            } else if (event.data.type === LOOPBACK_REDIRECT_REQUEST || event.data.type === LOOPBACK_REDIRECT_CANCEL) {
                // a sign-in redirect to catch on this device, or one to stop catching
                const message = parseLoopbackRedirectMessage(event.data);
                const target = frame?.contentWindow;
                if (!message) return;
                if (message.kind === "cancel") loopback.cancel(message.requestId);
                else if (target) void loopback.request(message.requestId, message.redirectUri).then((result) => {
                    target.postMessage({ type: LOOPBACK_REDIRECT_RESULT, generation: current, requestId: message.requestId, result }, "*");
                });
            } else {
                // a save or open dialog, answered on the frame that asked
                const request = parseFileTransferMessage(event.data);
                const target = frame?.contentWindow;
                if (!request || !target) return;
                void runPanelFileTransfer(computerId, panelId, request).then((result) => {
                    target.postMessage({ type: FILE_TRANSFER_RESULT, generation: current, requestId: request.requestId, result }, "*");
                });
            }
        };
        window.addEventListener("message", receive);
        // a reloaded document asked nothing; its open window closes unanswered
        // a document that goes mid-swipe leaves its page where it was, not half dragged
        // and its sign-in redirect stops being caught
        onCleanup(() => { if (frame) swipeFromFrame(frame, { phase: "cancel", dx: 0, velocity: 0 }); clearTimeout(timer); window.removeEventListener("message", receive); setChooser(null); loopback.closeAll(); });
    });
    onMount(() => { if (frame) frame.src = panelUrl(computerId, panelId, `?_r=${props.reload}&generation=${generation}`); });
    return <div class={styles.panelLayer} classList={{ [styles.away]: !props.current }}>
        <iframe ref={frame} data-panel-key={props.panelKey} title={panelId}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
            onLoad={() => { frame?.contentWindow?.postMessage({ type: "paperboard:initialize", generation, computerName: props.computerName }, "*"); }}
            class={`${styles.frame} ${styles.panelFrame}`} classList={{ [styles.unpainted]: !ready() || Boolean(failure()) || Boolean(props.restart) || Boolean(held()) }} />
        <BackupLocationChooser computerId={computerId} computerName={props.computerName} panelId={panelId} sourceId={chooser()?.sourceId} open={chooser() !== null} onDone={(result) => {
            const request = chooser();
            setChooser(null);
            if (request && request.generation === generation) request.target.postMessage({ type: BACKUP_LOCATION_RESULT, generation: request.generation, requestId: request.requestId, result }, "*");
        }} />
        <Show when={props.restart}>{(restart) => (
            <LoadingOverlay
                label={restart().kind === "failed" ? undefined : restart().kind === "updating" ? "Updating panel…" : "Restarting panel service…"}
                error={restart().kind === "failed" ? (restart() as { message: string }).message : undefined}
                retryLabel="Restart panel"
                onRetry={props.retryRestart}
            />
        )}</Show>
        <Show when={!props.restart && held()}>{(hold) => (
            <LoadingOverlay
                label={hold().kind === "create" ? "Backing up" : "Restoring a backup"}
                value={backupProgressFraction(hold()) ?? undefined}
                title={hold().kind === "create" ? "Backing up" : "Restoring a backup"}
                detail={backupProgressText(hold())}
            />
        )}</Show>
        <Show when={!props.restart && !held() && (!ready() || failure())}>
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
    // when each panel went out of view, and a clock to notice one has been away too long
    const [away, setAway] = createSignal<Record<string, number>>({});
    const [now, setNow] = createSignal(Date.now());
    createEffect(() => {
        const opened = props.openedPanels;
        const current = currentKey();
        setAway((prev) => recordAway(prev, opened, current, Date.now()));
    });
    onMount(() => {
        const clock = setInterval(() => setNow(Date.now()), 60_000);
        onCleanup(() => clearInterval(clock));
    });
    const live = () => withoutIdle(liveKeys(props.openedPanels, usageOrder(), currentKey(), MAX_LIVE_IFRAMES), away(), currentKey(), now(), IDLE_UNLOAD_MS);
    return <PaperFlex fullWidth fullHeight background="surface-raised" flex={1} overflow="hidden" class={styles.area}>
        <For each={props.openedPanels}>{(key) => <Show when={live().has(key)}>
            <PanelFrame panelKey={key} computerName={props.computerName(key.split("::")[0])} current={key === currentKey()} reload={props.reloadTokens?.[key] || 0} retry={() => props.onReloadPanel?.(key)}
                restart={props.restartStates?.[key]} retryRestart={() => props.onRestartPanel?.(key)} />
        </Show>}</For>
    </PaperFlex>;
};
export default PanelView;
