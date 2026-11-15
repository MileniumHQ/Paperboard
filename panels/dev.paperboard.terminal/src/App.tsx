import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperFlex,
    PaperButton,
    PaperEffect,
    PaperEmptyState,
    PaperIcon,
    PaperQuote,
    useContextMenuState,
    copyText,
    createPaperMobile,
    showToast,
    type ActionFailure,
    createPaperCompact,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { activeTerminals, copySelection, pasteClipboard } from "./Terminal";
import styles from "./Terminal.module.css";
import { createPanelBridge, serviceApi, terminalApi, type TerminalShell, errorMessage } from "@mileniumhq/paperapi";
import SavedCommands from "./SavedCommands";
import type { CommandRun, SavedCommand } from "./lib/savedCommands";
import SoftKeys from "./SoftKeys";
import { createKeyRow } from "./lib/keyRow";
import { createAttention } from "./lib/attention";
import { createFind } from "./FindBar";
import { createPasteConfirm } from "./PasteConfirm";
import { createRenameTab } from "./RenameTab";
import { ScreenMenu, ShellMenu, SplitMenu, TabMenu } from "./Menus";
import { TabBar, Toolbar } from "./TabBar";
import {
    SESSION_ERROR_TITLES,
    tabSessions,
    tabTitle,
    type LiveSession,
    type SessionErrorKind,
    type SessionErrors,
    type SplitDirection,
    type TabLayout,
    type TerminalTab,
} from "./lib/tabs";
import { PANEL_ID } from "./lib/panel";

interface TerminalBridgeState {
    tabs: TerminalTab[];
    activeTabId: string;
    live: Record<string, LiveSession>;
    layout: TabLayout;
    showTab: { id: string; request: string };
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    savedCommandsError: string;
    tabsError: string;
    sessionErrors: SessionErrors;
}

const bridge = createPanelBridge<TerminalBridgeState>({
    panelId: PANEL_ID,
    defaultState: {
        tabs: [],
        activeTabId: "",
        live: {},
        layout: "horizontal",
        showTab: { id: "", request: "" },
        savedCommands: [],
        commandRuns: {},
        savedCommandsError: "",
        tabsError: "",
        sessionErrors: {},
    },
});

export default function App() {
    const [activeTab, setActiveTab] = createSignal("");
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    const [hydration, setHydration] = createSignal<"loading" | "ready" | "failed">("loading");
    const [hydrationError, setHydrationError] = createSignal("");
    // the service answered, but could not read the saved tabs
    const [tabsUnreadable, setTabsUnreadable] = createSignal(false);
    // a tab action the service refused: shown over the terminals until
    // dismissed, or until the next action replaces it
    const [failure, setFailure] = createSignal<ActionFailure | null>(null);
    const report = (title: string, after = "") => (err: unknown) => {
        console.error(`[terminal] ${title}:`, err);
        setFailure({ title, message: errorMessage(err) + after });
    };
    // the tab list is the service's: every window on every computer mirrors
    // it, so a tab opened, renamed, moved or closed anywhere shows up here.
    // Keyed by id, so a tab keeps its object (and its live terminal) across
    // updates instead of remounting. Which tab is shown stays per window.
    const [mirror, setMirror] = createStore<{ tabs: TerminalTab[]; live: Record<string, LiveSession>; layout: TabLayout; sessionErrors: SessionErrors }>({
        tabs: [],
        live: {},
        layout: "horizontal",
        sessionErrors: {},
    });
    const tabs = () => mirror.tabs;
    // on a phone the tabs are always along the top: a side list would take
    // most of the width, and split shells share the one screen
    const compact = createPaperCompact();
    const mobile = createPaperMobile();
    const vertical = () => mirror.layout === "vertical" && !compact();
    const applyTabs = (next: unknown) => {
        if (Array.isArray(next)) setMirror("tabs", reconcile(next as TerminalTab[], { key: "id" }));
    };
    const [saved, setSaved] = createStore<Pick<TerminalBridgeState, "savedCommands" | "commandRuns" | "savedCommandsError">>({
        savedCommands: [],
        commandRuns: {},
        savedCommandsError: "",
    });
    const applySaved = (full: TerminalBridgeState) => {
        setSaved("savedCommands", reconcile(full.savedCommands ?? [], { key: "id" }));
        setSaved("commandRuns", reconcile(full.commandRuns ?? {}));
        setSaved("savedCommandsError", full.savedCommandsError ?? "");
    };

    // which of a split tab's two shells has the keyboard, per tab
    const [focusedPane, setFocusedPane] = createStore<Record<string, string>>({});
    const focusedOf = (tab: TerminalTab) => {
        const chosen = focusedPane[tab.id];
        return tabSessions(tab).some((s) => s.id === chosen) ? chosen : tab.id;
    };
    const shownTab = () => tabs().find((t) => t.id === activeTab());
    // the shell the toolbar and menus act on: the focused one of the shown tab
    const currentSession = () => {
        const tab = shownTab();
        return tab ? focusedOf(tab) : "";
    };
    const currentScreen = () => activeTerminals.get(currentSession());
    const keys = createKeyRow(mobile, currentScreen);
    const attention = createAttention(tabs, activeTab);
    const find = createFind(currentSession);
    const pasteConfirm = createPasteConfirm();
    const rename = createRenameTab();

    // what went wrong for the shell in front where no one was waiting on it;
    // each stands while it is true, and this window can put it away. Keyed
    // by session, kind and message, so a row keeps its identity while it stands.
    const [putAway, setPutAway] = createStore<Record<string, true>>({});
    const sessionErrors = () => {
        const session = currentSession();
        return Object.entries(mirror.sessionErrors[session] ?? {})
            .map(([kind, message]) => [session, kind, message].join("\n"))
            .filter((key) => !putAway[key]);
    };
    const describeSessionError = (key: string) => {
        const [, kind, ...message] = key.split("\n");
        return { title: SESSION_ERROR_TITLES[kind as SessionErrorKind], message: message.join("\n") };
    };
    const applySessionErrors = (next: unknown) => {
        if (next && typeof next === "object") setMirror("sessionErrors", reconcile(next as SessionErrors));
    };

    const applyLive = (next: unknown) => {
        if (!next || typeof next !== "object") return;
        setMirror("live", reconcile(next as Record<string, LiveSession>));
        attention.live(next as Record<string, LiveSession>);
    };

    // Show Tab (a block) switches every open window; a window follows each
    // request once, and one made before it opened is already its first tab
    let followedShow = "";
    const followShow = (request: TerminalBridgeState["showTab"] | undefined) => {
        if (!request?.request || request.request === followedShow) return;
        followedShow = request.request;
        if (tabs().some((t) => t.id === request.id)) setActiveTab(request.id);
    };
    bridge.onStateChange((patch, full) => {
        applyTabs(patch.tabs);
        applyLive(patch.live);
        applySessionErrors(patch.sessionErrors);
        if (patch.layout) setMirror("layout", patch.layout);
        applySaved(full);
        if (hydration() === "ready") followShow(full.showTab);
    });

    // the shells this computer has, for a new tab's menu
    const [shells, setShells] = createSignal<TerminalShell[]>([]);
    const loadShells = () =>
        terminalApi
            .shells()
            .then(setShells)
            .catch(report("Shells not listed", ". New tabs start with this computer's default shell."));

    const hydrate = async () => {
        setHydration("loading");
        try {
            const state = await bridge.refreshState();
            // unreadable is not empty either: no fresh tab opens over saved ones
            setTabsUnreadable(Boolean(state.tabsError));
            if (state.tabsError) throw new Error(state.tabsError);
            applyTabs(state.tabs);
            applyLive(state.live);
            applySessionErrors(state.sessionErrors);
            setMirror("layout", state.layout ?? "horizontal");
            followedShow = state.showTab?.request ?? "";
            if (!activeTab()) setActiveTab(state.activeTabId || tabs()[0]?.id || "");
            setHydration("ready");
            void loadShells();
            // opening the panel with every tab closed starts a shell
            if (tabs().length === 0) await addTab();
        } catch (err) {
            // unavailable is not empty: never open a fresh tab over a
            // service that did not answer
            setHydrationError(errorMessage(err));
            setHydration("failed");
        }
    };
    onMount(() => void hydrate());

    // a tab closed in another window takes this window to a remaining one
    createEffect(
        on([hydration, tabs, activeTab], ([state, list, active]) => {
            if (state !== "ready") return;
            if (!list.some((t) => t.id === active)) setActiveTab(list[0]?.id ?? "");
        }),
    );

    // a screen takes the keyboard once it is mounted and shown
    const focusSession = (id: string) => queueMicrotask(() => activeTerminals.get(id)?.focus());

    const handleCloseTab = (closedId: string) => {
        const current = tabs();
        const closedIndex = current.findIndex((item) => item.id === closedId);
        if (closedIndex < 0) return;
        if (activeTab() === closedId) {
            const next = closedIndex > 0 ? current[closedIndex - 1] : current[1];
            if (next) {
                handleSwitchTab(next.id);
                // the tab that comes forward has the keyboard, so typing goes on where it left off
                focusSession(focusedOf(next));
            }
        }
        // the tab leaves when the service says it closed; a failed close
        // leaves it in place, where closing it again retries
        setFailure(null);
        serviceApi
            .call(PANEL_ID, "close-tab", { id: closedId })
            .catch(report("Tab not closed"));
    };
    // a new tab opens where you are: in the folder of the shell in front
    const addTab = async (shell?: string) => {
        setFailure(null);
        try {
            const besides = currentSession();
            const id = await serviceApi.call<string>(
                PANEL_ID,
                "create-tab",
                { ...(besides ? { besides } : {}), ...(shell ? { shell } : {}) },
            );
            if (!id) throw new Error("The terminal service answered without a tab.");
            // the state push travels beside this answer; pull it so the new
            // tab is listed before it is shown. The pull reaches onStateChange
            // above, and a push that lands meanwhile wins over it
            await bridge.refreshState();
            setActiveTab(id);
            focusSession(id);
        } catch (err) {
            report("Tab not opened")(err);
        }
    };
    const handleSwitchTab = (id: string) => {
        setActiveTab(id);
        // the last used tab is what the next window opens on
        serviceApi
            .call(PANEL_ID, "touch-tab", { id })
            .catch(report("Tab not remembered", ". The next window may open on another tab."));
    };
    // a shell picked in the tab list: its tab is shown, and it has the keyboard
    const chooseSession = (id: string) => {
        const owner = attention.ownerOf(id);
        if (!owner) return;
        setFocusedPane(owner.id, id);
        if (owner.id !== activeTab()) handleSwitchTab(owner.id);
        queueMicrotask(() => activeTerminals.get(id)?.focus());
    };
    const reorder = (ids: string[]) => {
        const current = tabs();
        // a split's second shell is listed but moves with its tab
        const reordered = ids.map((id) => current.find((item) => item.id === id)!).filter(Boolean);
        if (reordered.every((t, i) => t.id === current[i]?.id)) return;
        // shown at once; the service's order is the truth, so a failed
        // reorder pulls it back
        setMirror("tabs", reordered);
        setFailure(null);
        serviceApi
            .call(PANEL_ID, "reorder-tabs", { orderedIds: reordered.map((t) => t.id) })
            .catch((err) => {
                report("Tab order not saved", ". The tabs are back in their saved order.")(err);
                bridge
                    .refreshState()
                    .catch(report("Tabs not reloaded", ". This window may show an order the service doesn't have."));
            });
    };
    const split = (tabId: string, direction: SplitDirection) => {
        setFailure(null);
        serviceApi
            .call<string>(PANEL_ID, "split-tab", { id: tabId, direction })
            .then(async (pane) => {
                // the new shell is listed before it is shown
                await bridge.refreshState();
                setFocusedPane(tabId, pane);
                focusSession(pane);
            })
            .catch(report("Tab not split"));
    };
    const unsplit = (tabId: string) => {
        setFailure(null);
        serviceApi.call(PANEL_ID, "unsplit-tab", { id: tabId }).catch(report("Split not closed"));
    };
    const toggleLayout = () => {
        setFailure(null);
        const next: TabLayout = vertical() ? "horizontal" : "vertical";
        // shown at once; the service's layout is the truth
        setMirror("layout", next);
        serviceApi.call(PANEL_ID, "set-tab-layout", { layout: next }).catch((err) => {
            setMirror("layout", next === "vertical" ? "horizontal" : "vertical");
            report("Layout not saved")(err);
        });
    };
    // the phone shows no pointer or selection handles, so a copy says it happened
    const copied = (what: string) => mobile() && showToast({ title: `${what} copied`, variant: "success", duration: 1500 });
    const copy = () => {
        setFailure(null);
        copySelection(currentSession()).then(() => copied("Selection"), report("Nothing copied"));
    };
    const paste = () => {
        setFailure(null);
        pasteClipboard(currentSession()).catch(report("Nothing pasted"));
    };
    const copyLastOutput = () => {
        setFailure(null);
        const output = currentScreen()?.lastOutput();
        if (output === null || output === undefined) {
            setFailure({
                title: "No output to copy",
                message: "No command has finished in this shell yet. bash, zsh, fish and PowerShell mark their commands; sh and cmd don't.",
            });
            return;
        }
        copyText(output)
            .then((ok) => {
                if (!ok) throw new Error("The clipboard refused the output.");
                copied("Last output");
            })
            .catch(report("Output not copied"));
    };
    // the phone can't select text on the screen, so its Copy copies what is
    // selected or, with nothing selected, the last command's output
    const copyForKeyRow = () => {
        if (currentScreen()?.term.hasSelection()) copy();
        else copyLastOutput();
        keys.keepKeyboard();
    };
    const pasteForKeyRow = () => {
        paste();
        keys.keepKeyboard();
    };

    const terminalMenu = useContextMenuState();
    const tabMenu = useContextMenuState();
    const savedMenu = useContextMenuState();
    const shellMenu = useContextMenuState();
    const splitMenu = useContextMenuState();
    const openTabMenu = (e: MouseEvent, tabId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextTabId(tabId);
        tabMenu.openAtMouse(e);
    };
    const contextTab = () => tabs().find((t) => t.id === contextTabId());
    const renameContextTab = () => {
        const tab = contextTab();
        setContextTabId(null);
        // what the tab shows: a tab that was never named is called by its program, and that is the name to start from
        if (tab) rename.open(tab.id, tab.named ? tab.label : tabTitle(tab, mirror.live, tab.id));
    };

    // the screen of one shell in a tab; a split's second shell keeps a floor
    // so dragging the line can't close it
    // On a phone only the shell with the keyboard shows (the tab list lists
    // both): it stays mounted when hidden, as every screen does.
    const awayOnPhone = (tab: TerminalTab, session: string) => compact() && focusedOf(tab) !== session;
    const Pane = (paneProps: { tab: TerminalTab; session: string; class?: string; floor?: boolean }) => (
        <PaperFlex
            flex
            minWidth={paneProps.floor && !compact() ? "field" : 0}
            minHeight={paneProps.floor && !compact() ? "field" : 0}
            direction="column"
            class={paneProps.class}
            hidden={awayOnPhone(paneProps.tab, paneProps.session)}
        >
            <TerminalComponent
                id={paneProps.session}
                focused={activeTab() === paneProps.tab.id && focusedOf(paneProps.tab) === paneProps.session}
                onFocus={() => setFocusedPane(paneProps.tab.id, paneProps.session)}
                onContextMenu={terminalMenu.openAtMouse}
                onFailure={(shown) => setFailure(shown)}
                onActivity={() => attention.output(paneProps.session)}
                onBell={() => attention.bell(paneProps.session)}
                onKeyAction={(action) => action === "find" && find.open()}
                modifiers={keys.modifiers}
                onModifiersUsed={keys.used}
                confirmPaste={pasteConfirm.confirm}
            />
        </PaperFlex>
    );

    return (
        <>
            {/* the keyboard covers the bottom of the panel: lift everything above it */}
            <PaperFlex
                class={`paperui-root unselectable ${styles.keyboardAvoid}`}
                style={{ "--terminal-keyboard-inset": `${keys.keyboardInset()}px` }}
                fullWidth
                fullHeight
                direction={vertical() ? "row" : "column"}
            >
                <Show when={tabs().length > 0}>
                    {/* the buttons after the tabs stay where they are while the tabs scroll */}
                    <PaperFlex direction={vertical() ? "column" : "row"} align={vertical() ? undefined : "center"} fullHeight={vertical()} minWidth={0} minHeight={0}>
                        <PaperFlex flex minWidth={0} minHeight={0}>
                            <TabBar
                                tabs={tabs()}
                                live={mirror.live}
                                vertical={vertical()}
                                value={currentSession()}
                                status={attention.status}
                                rang={attention.rang}
                                onChoose={chooseSession}
                                onReorder={reorder}
                                onCloseTab={handleCloseTab}
                                onUnsplit={unsplit}
                                onMenu={openTabMenu}
                            />
                        </PaperFlex>
                        <Toolbar
                            vertical={vertical()}
                            compact={compact()}
                            shown={shownTab()}
                            manyShells={shells().length > 1}
                            shellMenu={shellMenu}
                            splitMenu={splitMenu}
                            savedMenu={savedMenu}
                            onNewTab={() => void addTab()}
                            onUnsplit={() => unsplit(activeTab())}
                            onToggleLayout={toggleLayout}
                        />
                    </PaperFlex>
                </Show>
                <PaperFlex direction="column" flex minWidth={0} minHeight={0} fullHeight={vertical()}>
                    <Show when={failure() || sessionErrors().length > 0}>
                        <PaperFlex direction="column" gap="half" fullWidth padding="half">
                            <Show when={failure()}>
                                {(shown) => (
                                    <PaperQuote variant="danger" icon="warning" title={shown().title} role="alert" onDismiss={() => setFailure(null)}>
                                        {shown().message}
                                    </PaperQuote>
                                )}
                            </Show>
                            <For each={sessionErrors()}>
                                {(key) => (
                                    <PaperQuote variant="warning" icon="warning" title={describeSessionError(key).title} role="alert" onDismiss={() => setPutAway(key, true)}>
                                        {describeSessionError(key).message}
                                    </PaperQuote>
                                )}
                            </For>
                        </PaperFlex>
                    </Show>
                    {find.bar}
                    <PaperFlex fullWidth flex minHeight={0} overflow="hidden" class={styles.stack}>
                        <Show when={hydration() === "failed"}>
                            <PaperFlex fullWidth fullHeight align="center" justify="center">
                                <PaperEmptyState
                                    icon={tabsUnreadable() ? "error" : "cloud_off"}
                                    title={tabsUnreadable() ? "Your tabs couldn't be read" : "The terminal service is not answering"}
                                    description={hydrationError()}
                                >
                                    <Show when={!tabsUnreadable()}>
                                        <PaperButton variant="primary" onClick={() => void hydrate()}>
                                            <PaperIcon>refresh</PaperIcon> Try again
                                        </PaperButton>
                                    </Show>
                                </PaperEmptyState>
                            </PaperFlex>
                        </Show>
                        <Show when={hydration() === "ready" && tabs().length === 0}>
                            <PaperFlex fullWidth fullHeight align="center" justify="center">
                                <PaperEmptyState
                                    icon="terminal"
                                    title="No terminals open"
                                    description="Open a new tab to start a shell."
                                >
                                    <PaperEffect variant="primary">
                                        <PaperButton variant="primary" onClick={() => void addTab()}>
                                            <PaperIcon>add</PaperIcon> New Tab
                                        </PaperButton>
                                    </PaperEffect>
                                </PaperEmptyState>
                            </PaperFlex>
                        </Show>
                        <For each={tabs()}>
                            {(tab) => (
                                <div classList={{ [styles.layer]: true, [styles.hidden]: activeTab() !== tab.id }}>
                                    <PaperFlex direction={tab.split?.direction === "down" ? "column" : "row"} fullWidth fullHeight minHeight={0}>
                                        {/* the first shell is one pane whether or not a split sits beside it, so
                                            splitting never rebuilds its screen; the line between the two shells
                                            drags and each keeps a floor */}
                                        <PaperFlex
                                            direction={tab.split?.direction === "down" ? "column" : "row"}
                                            resizable={!!tab.split && !compact()}
                                            flex
                                            minWidth={tab.split && !compact() ? "field" : 0}
                                            minHeight={tab.split && !compact() ? "field" : 0}
                                            hidden={awayOnPhone(tab, tab.id)}
                                        >
                                            <Pane tab={tab} session={tab.id} />
                                        </PaperFlex>
                                        <Show when={tab.split}>
                                            {(shown) => {
                                                // read once: a split keeps its session, and a read
                                                // after the split closes would throw mid-update
                                                const session = shown().session.id;
                                                return (
                                                    <Pane
                                                        tab={tab}
                                                        session={session}
                                                        floor
                                                        class={tab.split?.direction === "down" ? styles.splitDown : styles.splitRight}
                                                    />
                                                );
                                            }}
                                        </Show>
                                    </PaperFlex>
                                </div>
                            )}
                        </For>
                    </PaperFlex>
                    <Show when={keys.shown()}>
                        <SoftKeys
                            ctrl={keys.modifiers().ctrl}
                            alt={keys.modifiers().alt}
                            onToggle={keys.toggle}
                            onKey={keys.press}
                            onType={keys.type}
                            onCopy={copyForKeyRow}
                            onPaste={pasteForKeyRow}
                            onHideKeyboard={keys.hideKeyboard}
                        />
                    </Show>
                </PaperFlex>
            </PaperFlex>
            <TabMenu
                state={tabMenu}
                split={Boolean(contextTab()?.split)}
                compact={compact()}
                onClose={() => {
                    tabMenu.close();
                    setContextTabId(null);
                }}
                onRename={renameContextTab}
                onSplit={(direction) => split(contextTabId()!, direction)}
                onUnsplit={() => unsplit(contextTabId()!)}
                onCloseTab={() => handleCloseTab(contextTabId()!)}
            />
            <ScreenMenu
                state={terminalMenu}
                split={Boolean(shownTab()?.split)}
                compact={compact()}
                onCopy={copy}
                onPaste={paste}
                onCopyLastOutput={copyLastOutput}
                onFind={find.open}
                onJump={(direction) => currentScreen()?.jumpToPrompt(direction)}
                onSplit={(direction) => split(activeTab(), direction)}
                onUnsplit={() => unsplit(activeTab())}
            />
            <SplitMenu state={splitMenu} onSplit={(direction) => split(activeTab(), direction)} />
            <ShellMenu state={shellMenu} shells={shells()} onPick={(path) => void addTab(path)} />
            <SavedCommands menu={savedMenu} commands={saved.savedCommands} runs={saved.commandRuns} loadError={saved.savedCommandsError} />
            {pasteConfirm.modal}
            {rename.modal}
        </>
    );
}
