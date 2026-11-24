import { PaperFlex, playHaptic, swipeFromFrame } from "@mileniumhq/paperui";
import { PAGE_BACK_MESSAGE, PAGE_BARS_MESSAGE } from "@mileniumhq/paperapi";
import { type Component, type JSX, createEffect, createMemo, createSignal, For, on, Show, onCleanup, onMount } from "solid-js";
import { recordUse, liveKeys, recordAway, withoutIdle, MAX_LIVE_IFRAMES, IDLE_UNLOAD_MS } from "./panelLru";
import LoadingOverlay from "./LoadingOverlay";
import styles from "./frame.module.css";
import { panelUrl } from "../../lib/shell";
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
    /** the color a panel reports along its bottom edge, or undefined before it does */
    onFootColor?: (key: string, color: string | undefined) => void;
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
    onFootColor: (color: string | undefined) => void;
    backs: Map<string, () => void>;
}

const PanelFrame: Component<PanelFrameProps> = (props) => {
    // the frame is keyed by its panel (PanelView's <For> over the keys), so these name one panel for its life
    const computerId = () => props.panelKey.split("::")[0];
    const panelId = () => props.panelKey.split("::")[1];
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
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
                setFailure(message);
            },
            // the panel's list had no page to go back from: this frame's page goes back
            onSwipeBack: (data) => { if (frame && props.current) swipeFromFrame(frame, data as Parameters<typeof swipeFromFrame>[1]); },
            // frames can't vibrate; the shell plays it, if it is a kind it knows
            onHaptic: (kind) => { if (props.current) playHaptic(kind as Parameters<typeof playHaptic>[0]); },
            onCrumbs: (titles) => props.onCrumbs(titles),
            onFootColor: (color) => props.onFootColor(color),
            choosing: () => chooser() !== null,
            onChooseLocation: (request) => setChooser({ ...request, generation: current }),
        });
        // the shell's Back goes back through the panel's own pages first; a new document has opened none yet
        props.backs.set(props.panelKey, () => { frame?.contentWindow?.postMessage({ type: PAGE_BACK_MESSAGE, generation: current }, "*"); });
        props.onCrumbs([]);
        props.onFootColor(undefined);
        // a reloaded document asked nothing; its open window closes unanswered,
        // and a document that goes mid-swipe leaves its page where it was
        onCleanup(() => {
            if (frame) swipeFromFrame(frame, { phase: "cancel", dx: 0, velocity: 0 });
            clearTimeout(timer); setChooser(null); doc.close();
            props.backs.delete(props.panelKey); props.onCrumbs([]); props.onFootColor(undefined);
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
            class={styles.frame} classList={{ [styles.panelFrame]: !props.mobile, [styles.unpainted]: !ready() || Boolean(failure()) || Boolean(props.restart) }} />
        <BackupLocationChooser computerId={computerId()} computerName={props.computerName} panelId={panelId()} panelName={props.heading.name} open={chooser() !== null} onDone={(result) => {
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
                errorTitle={`Couldn't restart ${props.heading.name}`}
                retryLabel="Restart panel"
                onRetry={props.retryRestart}
            />
        )}</Show>
        <Show when={!props.restart && (!ready() || failure())}>
            <LoadingOverlay
                heading={props.heading}
                compact={props.mobile}
                label={failure() ? undefined : "Connecting panel…"}
                error={failure() || undefined}
                errorTitle={`Couldn't load ${props.heading.name}`}
                detail={failure() ? (props.heading.serviceError ? `Its service stopped: ${props.heading.serviceError}` : undefined) : undefined}
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
                    onCrumbs={(titles) => props.onCrumbs(key, titles)} onFootColor={(color) => props.onFootColor?.(key, color)} backs={props.backs} />
            </Show>;
        }}</For>
    </PaperFlex>;
};
export default PanelView;
