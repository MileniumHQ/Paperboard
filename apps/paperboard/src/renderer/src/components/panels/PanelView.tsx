import { dismissToast, PaperFlex, playHaptic, showToast, swipeFromFrame } from "@mileniumhq/paperui";
import { backupApi, backupProgressFraction, backupProgressText, type BackupProgress, errorMessage, PAGE_BACK_MESSAGE, PAGE_BARS_MESSAGE } from "@mileniumhq/paperapi";
import { type Component, type JSX, createEffect, createMemo, createSignal, For, on, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, recordAway, withoutIdle, MAX_LIVE_IFRAMES, IDLE_UNLOAD_MS } from "./panelLru";
import LoadingOverlay from "./LoadingOverlay";
import styles from "./frame.module.css";
import { logToMain, panelUrl } from "../../lib/shell";
import { MOBILE_MODE_MESSAGE, mobileMode, requireMobileMode } from "../../lib/mobileMode";
import BackupLocationChooser from "../backups/BackupLocationChooser";
import { unsavedPanels } from "../../lib/unsavedPanels";
import { createFrameDocument, type ChooserRequest } from "./frameMessages";

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
    /**
     * A panel's own open pages, outermost first, as it names them. In the
     * phone layout the shell's bar names them and the pages draw no bar of
     * their own.
     */
    onCrumbs: (key: string, titles: string[]) => void;
    /** each live panel's way back one of its own pages, by key */
    backs: Map<string, () => void>;
}

interface PanelFrameProps {
    panelKey: string;
    heading: PanelHeading;
    mobile: boolean;
    computerName: string;
    /** the frame on screen: only it swipes its page and plays haptics */
    current: boolean;
    reload: number;
    retry: () => void;
    restart?: RestartState;
    retryRestart: () => void;
    failed: () => void;
    onCrumbs: (titles: string[]) => void;
    backs: Map<string, () => void>;
}

// Every open frame of a computer follows its backups over the one
// connection to it: while that is lost, one notice says so, until it is back
// or no frame follows any more.
const lostFrames = new Map<string, { frames: Set<string>; toast: string }>();
function progressLost(computerId: string, frameKey: string, why: string | null): void {
    const lost = lostFrames.get(computerId);
    if (why !== null) {
        if (lost) lost.frames.add(frameKey);
        else lostFrames.set(computerId, { frames: new Set([frameKey]), toast: showToast({ variant: "warning", key: `backup-progress:${computerId}`, title: "Can't follow backups", message: `${why}. Paperboard keeps trying.` }) });
        return;
    }
    if (!lost?.frames.delete(frameKey) || lost.frames.size > 0) return;
    lostFrames.delete(computerId);
    dismissToast(lost.toast);
}

const PanelFrame: Component<PanelFrameProps> = (props) => {
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
            setBackupsError(`Couldn't check for a backup holding it: ${errorMessage(err)}`);
        },
    );
    onMount(() => {
        const off = backupApi.onProgress(panelId(), (change) => setBackups((prev) => {
            const next = { ...prev };
            if (change.progress) next[change.sourceId ?? ""] = change.progress;
            else delete next[change.sourceId ?? ""];
            return next;
        }), computerId(), (why) => {
            progressLost(computerId(), props.panelKey, why === null ? null : `${props.computerName}: ${why}`);
            // what changed while it was lost (a backup's end) is read again
            if (why === null) void refreshBackups();
        });
        onCleanup(() => {
            off();
            progressLost(computerId(), props.panelKey, null);
        });
        void refreshBackups();
    });
    const isHeld = () => held() !== null;
    // the service is back: a page that lost it while held loads again. Only
    // the hold ending triggers it, not the reload it starts.
    createEffect(on(isHeld, (holding, wasHolding) => {
        if (wasHolding && !holding && (failure() || !ready())) props.retry();
    }));
    // the backup location window this frame's document asked for, answered on it
    const [chooser, setChooser] = createSignal<(ChooserRequest & { generation: string }) | null>(null);
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
        const doc = createFrameDocument({
            computerId: computerId(),
            panelId: panelId(),
            panelKey: props.panelKey,
            generation: current,
            window: () => frame?.contentWindow,
            onReady: () => { clearTimeout(timer); setReady(true); setFailure(""); },
            onFailed: (message) => {
                clearTimeout(timer);
                // a backup that just stopped the service explains the failure
                void refreshBackups().then(() => { if (generation === current) setFailure(message); });
            },
            // the panel's list had no page to go back from: this frame's page goes back
            onSwipeBack: (data) => { if (frame && props.current) swipeFromFrame(frame, data as Parameters<typeof swipeFromFrame>[1]); },
            // frames can't vibrate; the shell plays it, if it is a kind it knows
            onHaptic: (kind) => { if (props.current) playHaptic(kind as Parameters<typeof playHaptic>[0]); },
            onCrumbs: (titles) => props.onCrumbs(titles),
            choosing: () => chooser() !== null,
            onChooseLocation: (request) => setChooser({ ...request, generation: current }),
        });
        // the shell's Back goes back through the panel's own pages first; a new document has opened none yet
        props.backs.set(props.panelKey, () => { frame?.contentWindow?.postMessage({ type: PAGE_BACK_MESSAGE, generation: current }, "*"); });
        props.onCrumbs([]);
        // a reloaded document asked nothing; its open window closes unanswered,
        // and a document that goes mid-swipe leaves its page where it was
        onCleanup(() => {
            if (frame) swipeFromFrame(frame, { phase: "cancel", dx: 0, velocity: 0 });
            clearTimeout(timer); setChooser(null); doc.close();
            props.backs.delete(props.panelKey); props.onCrumbs([]);
        });
    }));
    createEffect(on(failure, (message) => { if (message) props.failed(); }, { defer: true }));
    // mobile mode turning on or off reaches a frame already challenged
    createEffect(on(mobileMode, (mobile) => { if (mobile !== null) frame?.contentWindow?.postMessage({ type: MOBILE_MODE_MESSAGE, generation, mobile }, "*"); }, { defer: true }));
    // the phone layout's bar names the panel's pages, which then draw none of their own; a foldable opening into the wide layout gives them back
    createEffect(on(() => props.mobile, (pageBars) => { frame?.contentWindow?.postMessage({ type: PAGE_BARS_MESSAGE, generation, pageBars }, "*"); }, { defer: true }));
    return <div class={styles.panelLayer} classList={{ [styles.away]: !props.current }}>
        <iframe ref={frame} data-panel-key={props.panelKey} title={panelId()}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
            onLoad={() => { frame?.contentWindow?.postMessage({ type: "paperboard:initialize", generation, computerName: props.computerName, mobile: requireMobileMode(), pageBars: props.mobile }, "*"); }}
            class={`${styles.frame} ${styles.panelFrame}`} classList={{ [styles.unpainted]: !ready() || Boolean(failure()) || Boolean(props.restart) || Boolean(held()) }} />
        <BackupLocationChooser computerId={computerId()} computerName={props.computerName} panelId={panelId()} panelName={props.heading.name} sourceId={chooser()?.sourceId} open={chooser() !== null} onDone={(result) => {
            const request = chooser();
            setChooser(null);
            if (request && request.generation === generation) request.answer(result);
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
                    restart={props.restartStates?.[key]} retryRestart={() => props.onRestartPanel?.(key)} failed={() => props.onPanelFailed?.(key)}
                    onCrumbs={(titles) => props.onCrumbs(key, titles)} backs={props.backs} />
            </Show>;
        }}</For>
    </PaperFlex>;
};
export default PanelView;
