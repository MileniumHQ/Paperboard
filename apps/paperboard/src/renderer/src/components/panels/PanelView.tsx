import { PaperFlex, playHaptic, swipeFromFrame } from "@mileniumhq/paperui";
import { backupApi, backupProgressFraction, backupProgressText, HAPTIC_MESSAGE, LEAVE_ANSWER_MESSAGE, LEAVE_REQUEST_MESSAGE, SWIPE_BACK_MESSAGE, UNSAVED_CHANGES_MESSAGE, type BackupProgress } from "@mileniumhq/paperapi";
import { type Component, type JSX, createEffect, createMemo, createSignal, For, on, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, recordAway, withoutIdle, MAX_LIVE_IFRAMES, IDLE_UNLOAD_MS } from "./panelLru";
import LoadingOverlay from "./LoadingOverlay";
import styles from "./frame.module.css";
import { logToMain, panelUrl } from "../../lib/shell";
import { MOBILE_MODE_MESSAGE, mobileMode, requireMobileMode } from "../../lib/mobileMode";
import { FILE_TRANSFER_RESULT, parseFileTransferMessage, runPanelFileTransfer } from "../../lib/panelFileTransfer";
import { createFrameLoopbackRedirects, LOOPBACK_REDIRECT_CANCEL, LOOPBACK_REDIRECT_REQUEST, LOOPBACK_REDIRECT_RESULT, parseLoopbackRedirectMessage } from "../../lib/panelLoopbackRedirect";
import BackupLocationChooser, { type BackupLocationChoice } from "../backups/BackupLocationChooser";
import { BACKUP_LOCATION_REQUEST, BACKUP_LOCATION_RESULT, parseBackupLocationRequest } from "../../lib/backupLocationRequest";
import { setPanelUnsaved, unsavedPanels, type LeaveAnswer } from "../../lib/unsavedPanels";

// restarting: the panel's service restarts; updating: a new release of the panel installs
export type RestartState = { kind: "restarting" } | { kind: "updating" } | { kind: "failed"; message: string };

/** a panel's loader heading, and why its service last failed (followed, like the rest) */
export type PanelHeading = { icon: JSX.Element; name: string; serviceError?: string };

export interface PanelViewProps {
    /** each panel's icon and name, headed on its loader; asked once per frame, and followed from then on */
    panelHeading: (key: string) => PanelHeading;
    /** the phone layout: the loader's heading draws smaller */
    mobile: boolean;
    activePanel: string;
    activeComputerId: string;
    /** what the shell calls each computer; a panel is told its own */
    computerName: (computerId: string) => string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
    onReloadPanel?: (key: string) => void;
    restartStates?: Record<string, RestartState>;
    onRestartPanel?: (key: string) => void;
    /** a panel's page could not load: the shell reads the panel list again, which says why its service failed */
    onPanelFailed?: (key: string) => void;
}

const PanelFrame: Component<{ panelKey: string; heading: PanelHeading; mobile: boolean; computerName: string; current: boolean; reload: number; retry: () => void; restart?: RestartState; retryRestart: () => void; failed: () => void }> = (props) => {
    // the frame is keyed by its panel (PanelView's <For> over the keys), so these name one panel for its life
    const computerId = () => props.panelKey.split("::")[0];
    const panelId = () => props.panelKey.split("::")[1];
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
    // A backup or restore stops the panel's service while it copies or swaps
    // the data. The frame says so, with how far along it is, instead of
    // failing to reach the service; by source ("" = the panel's own data).
    const [backups, setBackups] = createSignal<Record<string, BackupProgress>>({});
    const held = () => Object.values(backups()).find((p) => p.servicePaused) ?? null;
    // a failed look says so under a failure it may have explained
    const [backupsError, setBackupsError] = createSignal("");
    const refreshBackups = () => backupApi.progress(panelId(), computerId()).then(
        (list) => {
            setBackups(Object.fromEntries(list.map((p) => [p.sourceId ?? "", p])));
            setBackupsError("");
        },
        (err) => {
            logToMain("error", `Couldn't read ${panelId()}'s running backups:`, err);
            setBackupsError(`Couldn't check for a backup holding it: ${err instanceof Error ? err.message : String(err)}`);
        },
    );
    onMount(() => {
        const off = backupApi.onProgress(panelId(), (change) => setBackups((prev) => {
            const next = { ...prev };
            if (change.progress) next[change.sourceId ?? ""] = change.progress;
            else delete next[change.sourceId ?? ""];
            return next;
        }), computerId());
        onCleanup(off);
        void refreshBackups();
    });
    const isHeld = () => held() !== null;
    // a socket that dropped meanwhile misses the end: look again while held
    createEffect(on(isHeld, (holding) => {
        if (!holding) return;
        const timer = setInterval(() => void refreshBackups(), 5_000);
        onCleanup(() => clearInterval(timer));
    }));
    // the service is back: a page that lost it while held loads again. Only
    // the hold ending triggers it, not the reload it starts.
    createEffect(on(isHeld, (holding, wasHolding) => {
        if (wasHolding && !holding && (failure() || !ready())) props.retry();
    }));
    // the backup location window this frame asked for, answered on it
    const [chooser, setChooser] = createSignal<{ requestId: string; sourceId?: string; generation: string; target: Window } | null>(null);
    // only this frame's own reload token reloads it: the shell keeps every
    // panel's token in one record, and any other panel's restart or update
    // must leave this document alone
    const reloadToken = createMemo(() => props.reload);
    createEffect(on(reloadToken, (reload) => {
        generation = crypto.randomUUID();
        const current = generation;
        setReady(false); setFailure("");
        if (frame) frame.src = panelUrl(computerId(), panelId(), `?_r=${reload}&generation=${generation}`);
        const timer = setTimeout(() => setFailure("The panel did not finish connecting to its service."), 25_000);
        // a sign-in redirect this document asked the shell to catch
        const loopback = createFrameLoopbackRedirects(computerId());
        // what this document was asked about its unsaved work, by request
        const leaving = new Map<string, (answer: LeaveAnswer) => void>();
        const askToLeave = () => new Promise<LeaveAnswer>((resolve) => {
            const target = frame?.contentWindow;
            if (!target) return resolve({ leave: true });
            const requestId = crypto.randomUUID();
            leaving.set(requestId, resolve);
            target.postMessage({ type: LEAVE_REQUEST_MESSAGE, generation: current, requestId }, "*");
        });
        const receive = (event: MessageEvent) => {
            if (event.source !== frame?.contentWindow || event.data?.generation !== generation) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === panelId()) {
                clearTimeout(timer); setReady(true); setFailure("");
            } else if (event.data.type === "paperboard:failed") {
                clearTimeout(timer);
                // a backup that just stopped the service explains the failure
                const message = String(event.data.message || "Panel initialization failed");
                void refreshBackups().then(() => { if (generation === current) setFailure(message); });
            } else if (event.data.type === SWIPE_BACK_MESSAGE) {
                // the panel's list had no page to go back from: this frame's page goes back
                if (frame && props.current) swipeFromFrame(frame, event.data);
            } else if (event.data.type === UNSAVED_CHANGES_MESSAGE) {
                setPanelUnsaved(props.panelKey, event.data.unsaved === true ? askToLeave : null);
            } else if (event.data.type === LEAVE_ANSWER_MESSAGE) {
                const resolve = leaving.get(event.data.requestId);
                leaving.delete(event.data.requestId);
                resolve?.({ leave: event.data.leave === true, error: typeof event.data.error === "string" ? event.data.error : undefined });
            } else if (event.data.type === HAPTIC_MESSAGE) {
                // frames can't vibrate; the shell plays it, if it is a kind it knows
                if (props.current) playHaptic(event.data.kind);
            } else if (event.data.type === BACKUP_LOCATION_REQUEST) {
                const target = frame?.contentWindow;
                const request = parseBackupLocationRequest(event.data, panelId(), chooser() !== null);
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
                void runPanelFileTransfer(computerId(), panelId(), request).then((result) => {
                    target.postMessage({ type: FILE_TRANSFER_RESULT, generation: current, requestId: request.requestId, result }, "*");
                });
            }
        };
        window.addEventListener("message", receive);
        // a reloaded document asked nothing; its open window closes unanswered
        // a document that goes mid-swipe leaves its page where it was, not half dragged
        // and its sign-in redirect stops being caught
        // and its unsaved work is gone with it: nothing is left to ask
        onCleanup(() => {
            if (frame) swipeFromFrame(frame, { phase: "cancel", dx: 0, velocity: 0 });
            clearTimeout(timer); window.removeEventListener("message", receive); setChooser(null); loopback.closeAll();
            setPanelUnsaved(props.panelKey, null);
            for (const resolve of leaving.values()) resolve({ leave: true });
        });
    }));
    createEffect(on(failure, (message) => { if (message) props.failed(); }, { defer: true }));
    // mobile mode turning on or off reaches a frame already challenged
    createEffect(on(mobileMode, (mobile) => { if (mobile !== null) frame?.contentWindow?.postMessage({ type: MOBILE_MODE_MESSAGE, generation, mobile }, "*"); }, { defer: true }));
    return <div class={styles.panelLayer} classList={{ [styles.away]: !props.current }}>
        <iframe ref={frame} data-panel-key={props.panelKey} title={panelId()}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
            onLoad={() => { frame?.contentWindow?.postMessage({ type: "paperboard:initialize", generation, computerName: props.computerName, mobile: requireMobileMode() }, "*"); }}
            class={`${styles.frame} ${styles.panelFrame}`} classList={{ [styles.unpainted]: !ready() || Boolean(failure()) || Boolean(props.restart) || Boolean(held()) }} />
        <BackupLocationChooser computerId={computerId()} computerName={props.computerName} panelId={panelId()} sourceId={chooser()?.sourceId} open={chooser() !== null} onDone={(result) => {
            const request = chooser();
            setChooser(null);
            if (request && request.generation === generation) request.target.postMessage({ type: BACKUP_LOCATION_RESULT, generation: request.generation, requestId: request.requestId, result }, "*");
        }} />
        <Show when={props.restart}>{(restart) => (
            <LoadingOverlay
                heading={props.heading}
                compact={props.mobile}
                label={restart().kind === "failed" ? undefined : restart().kind === "updating" ? "Updating panel…" : "Restarting panel service…"}
                error={restart().kind === "failed" ? (restart() as { message: string }).message : undefined}
                retryLabel="Restart panel"
                onRetry={props.retryRestart}
            />
        )}</Show>
        <Show when={!props.restart && held()}>{(hold) => (
            <LoadingOverlay
                heading={props.heading}
                compact={props.mobile}
                label={hold().kind === "create" ? "Backing up" : "Restoring a backup"}
                value={backupProgressFraction(hold()) ?? undefined}
                title={hold().kind === "create" ? "Backing up" : "Restoring a backup"}
                detail={backupProgressText(hold())}
            />
        )}</Show>
        <Show when={!props.restart && !held() && (!ready() || failure())}>
            <LoadingOverlay
                heading={props.heading}
                compact={props.mobile}
                label={failure() ? undefined : "Connecting panel…"}
                error={failure() || undefined}
                detail={failure() ? (props.heading.serviceError ? `Its service stopped: ${props.heading.serviceError}` : backupsError() || undefined) : undefined}
                retryLabel="Reload panel"
                onRetry={props.retry}
            />
        </Show>
    </div>;
};

const PanelView: Component<PanelViewProps> = (props) => {
    const [usageOrder, setUsageOrder] = createSignal<string[]>([]);
    const currentKey = () => `${props.activeComputerId}::${props.activePanel}`;
    createEffect(on([() => props.openedPanels, currentKey], ([opened, current]) => setUsageOrder((prev) => recordUse(prev, opened, current))));
    // when each panel went out of view, and a clock to notice one has been away too long
    const [away, setAway] = createSignal<Record<string, number>>({});
    const [now, setNow] = createSignal(Date.now());
    createEffect(on([() => props.openedPanels, currentKey], ([opened, current]) => setAway((prev) => recordAway(prev, opened, current, Date.now()))));
    onMount(() => {
        const clock = setInterval(() => setNow(Date.now()), 60_000);
        onCleanup(() => clearInterval(clock));
    });
    // a page holding unsaved work stays loaded, however long it has been away
    const live = createMemo(() => {
        const kept = withoutIdle(liveKeys(props.openedPanels, usageOrder(), currentKey(), MAX_LIVE_IFRAMES), away(), currentKey(), now(), IDLE_UNLOAD_MS);
        for (const key of unsavedPanels()) if (props.openedPanels.includes(key)) kept.add(key);
        return kept;
    });
    return <PaperFlex fullWidth fullHeight background="surface-raised" flex={1} overflow="hidden" class={styles.area}>
        <For each={props.openedPanels}>{(key) => {
            const heading = props.panelHeading(key);
            return <Show when={live().has(key)}>
                <PanelFrame panelKey={key} heading={heading} mobile={props.mobile} computerName={props.computerName(key.split("::")[0])} current={key === currentKey()} reload={props.reloadTokens?.[key] || 0} retry={() => props.onReloadPanel?.(key)}
                    restart={props.restartStates?.[key]} retryRestart={() => props.onRestartPanel?.(key)} failed={() => props.onPanelFailed?.(key)} />
            </Show>;
        }}</For>
    </PaperFlex>;
};
export default PanelView;
