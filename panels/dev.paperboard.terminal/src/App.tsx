import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperButton,
    PaperCode,
    PaperEffect,
    PaperEmptyState,
    PaperIcon,
    PaperModal,
    PaperInput,
    PaperQuote,
    PaperText,
    useContextMenuState,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuHeader,
    copyText,
    type LoaderStatus,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { activeTerminals, copySelection, pasteClipboard } from "./Terminal";
import styles from "./Terminal.module.css";
import { actions as actionsApi, createPanelBridge, terminalApi, type TerminalShell } from "@mileniumhq/paperapi";
import { onMount } from "solid-js";
import SavedCommandsModal from "./SavedCommands";
import type { CommandRun, SavedCommand } from "./lib/savedCommands";
import { describeRun } from "./lib/runStatus";
import { errorMessage, type Outcome } from "./lib/failure";
import { shortcutLabel } from "./keys";
import { pasteLines } from "./lib/screen";
import { tabSessions, tabTitle, type LiveSession, type SplitDirection, type TabLayout, type TerminalTab } from "./lib/tabs";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// how long a hidden tab counts as busy after it last printed
const BUSY_MS = 1500;
// the lines of a paste shown when it is asked about
const PASTE_PREVIEW_LINES = 12;

export type { TerminalTab } from "./lib/tabs";

interface TerminalBridgeState {
    tabs: TerminalTab[];
    activeTabId: string;
    live: Record<string, LiveSession>;
    layout: TabLayout;
    showTab: { id: string; request: string };
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    savedCommandsError: string;
}

const bridge = createPanelBridge<TerminalBridgeState>({
    panelId: TERMINAL_PANEL_ID,
    defaultState: {
        tabs: [],
        activeTabId: "",
        live: {},
        layout: "horizontal",
        showTab: { id: "", request: "" },
        savedCommands: [],
        commandRuns: {},
        savedCommandsError: "",
    },
});

/** what a tab that isn't shown has done since it was last looked at, in this window */
interface Attention {
    /** printed in the last moments */
    busy?: boolean;
    /** a command ended: how */
    finished?: "success" | "error";
    /** rang the bell */
    bell?: boolean;
}

export default function App() {
    const [activeTab, setActiveTab] = createSignal("");
    const [isRenameOpen, setIsRenameOpen] = createSignal(false);
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    const [renameValue, setRenameValue] = createSignal("");
    const [hydration, setHydration] = createSignal<"loading" | "ready" | "failed">("loading");
    const [hydrationError, setHydrationError] = createSignal("");
    const [renaming, setRenaming] = createSignal(false);
    const [renameError, setRenameError] = createSignal("");
    // a tab action the service refused: shown over the terminals until
    // dismissed, or until the next action replaces it
    const [failure, setFailure] = createSignal<Outcome | null>(null);
    const report = (title: string, after = "") => (err: unknown) => {
        console.error(`[terminal] ${title}:`, err);
        setFailure({ title, message: errorMessage(err) + after });
    };
    // the tab list is the service's: every window on every computer mirrors
    // it, so a tab opened, renamed, moved or closed anywhere shows up here.
    // Keyed by id, so a tab keeps its object (and its live terminal) across
    // updates instead of remounting. Which tab is shown stays per window.
    const [mirror, setMirror] = createStore<{ tabs: TerminalTab[]; live: Record<string, LiveSession>; layout: TabLayout }>({
        tabs: [],
        live: {},
        layout: "horizontal",
    });
    const tabs = () => mirror.tabs;
    const vertical = () => mirror.layout === "vertical";
    const applyTabs = (next: unknown) => {
        if (Array.isArray(next)) setMirror("tabs", reconcile(next as TerminalTab[], { key: "id" }));
    };
    const [saved, setSaved] = createStore<Pick<TerminalBridgeState, "savedCommands" | "commandRuns" | "savedCommandsError">>({
        savedCommands: [],
        commandRuns: {},
        savedCommandsError: "",
    });
    const [isSavedOpen, setIsSavedOpen] = createSignal(false);
    // a run started from the dropdown that the service refused: shown in the
    // saved commands modal, since the dropdown has closed by then
    const [savedRunError, setSavedRunError] = createSignal("");
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
    const folderOf = (tab: TerminalTab) => mirror.live[focusedOf(tab)]?.cwd || tab.cwd || "";

    // ── what hidden tabs did, in this window ────────────────────────────────
    const [attention, setAttention] = createStore<Record<string, Attention>>({});
    const busyTimers = new Map<string, ReturnType<typeof setTimeout>>();
    onCleanup(() => busyTimers.forEach(clearTimeout));
    const ownerOf = (session: string) => tabs().find((t) => tabSessions(t).some((s) => s.id === session));
    const notice = (session: string, change: Attention) => {
        const tab = ownerOf(session);
        if (!tab || tab.id === activeTab()) return;
        setAttention(tab.id, (prev) => ({ ...prev, ...change }));
        return tab.id;
    };
    const noticeOutput = (session: string) => {
        const tabId = notice(session, { busy: true });
        if (!tabId) return;
        clearTimeout(busyTimers.get(tabId));
        busyTimers.set(tabId, setTimeout(() => setAttention(tabId, "busy", false), BUSY_MS));
    };
    // the commands this window has seen end, so only new ones are told
    const seenCommand: Record<string, number> = {};
    let commandsSeen = false;
    const applyLive = (next: unknown) => {
        if (!next || typeof next !== "object") return;
        setMirror("live", reconcile(next as Record<string, LiveSession>));
        for (const [session, state] of Object.entries(next as Record<string, LiveSession>)) {
            const seq = state.command?.seq ?? 0;
            if (seq <= (seenCommand[session] ?? 0)) continue;
            seenCommand[session] = seq;
            // what had ended before this window opened is not news
            if (commandsSeen) notice(session, { finished: state.command!.exitCode === 0 ? "success" : "error" });
        }
        commandsSeen = true;
    };
    // looking at a tab is seeing what it did
    createEffect(on(activeTab, (id) => id && setAttention(id, {})));
    const statusOf = (tabId: string): LoaderStatus | undefined => {
        const a = attention[tabId];
        if (a?.busy) return "indeterminate";
        return a?.finished;
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
            applyTabs(state.tabs);
            applyLive(state.live);
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
    createEffect(() => {
        if (hydration() !== "ready") return;
        const list = tabs();
        if (!list.some((t) => t.id === activeTab())) setActiveTab(list[0]?.id ?? "");
    });

    const handleCloseTab = (closedId: string) => {
        const current = tabs();
        const closedIndex = current.findIndex((item) => item.id === closedId);
        if (closedIndex < 0) return;
        if (activeTab() === closedId) {
            if (closedIndex > 0) {
                setActiveTab(current[closedIndex - 1].id);
            } else if (current.length > 1) {
                setActiveTab(current[1].id);
            }
        }
        // the tab leaves when the service says it closed; a failed close
        // leaves it in place, where closing it again retries
        setFailure(null);
        actionsApi
            .call(TERMINAL_PANEL_ID, "close-tab", { id: closedId })
            .catch(report("Tab not closed"));
    };
    // a new tab opens where you are: in the folder of the shell in front
    const addTab = async (shell?: string) => {
        setFailure(null);
        try {
            const besides = currentSession();
            const id = await actionsApi.call<string>(
                TERMINAL_PANEL_ID,
                "create-tab",
                { ...(besides ? { besides } : {}), ...(shell ? { shell } : {}) },
            );
            if (!id) throw new Error("The terminal service answered without a tab.");
            // the state push travels beside this answer; pull it so the new
            // tab is listed before it is shown
            applyTabs((await bridge.refreshState()).tabs);
            setActiveTab(id);
        } catch (err) {
            report("Tab not opened")(err);
        }
    };
    const handleSwitchTab = (id: string) => {
        setActiveTab(id);
        // the last used tab is what the next window opens on
        actionsApi
            .call(TERMINAL_PANEL_ID, "touch-tab", { id })
            .catch(report("Tab not remembered", ". The next window may open on another tab."));
    };
    const split = (tabId: string, direction: SplitDirection) => {
        setFailure(null);
        actionsApi
            .call<string>(TERMINAL_PANEL_ID, "split-tab", { id: tabId, direction })
            .then((pane) => setFocusedPane(tabId, pane))
            .catch(report("Tab not split"));
    };
    const unsplit = (tabId: string) => {
        setFailure(null);
        actionsApi.call(TERMINAL_PANEL_ID, "unsplit-tab", { id: tabId }).catch(report("Split not closed"));
    };
    const toggleLayout = () => {
        setFailure(null);
        const next: TabLayout = vertical() ? "horizontal" : "vertical";
        // shown at once; the service's layout is the truth
        setMirror("layout", next);
        actionsApi.call(TERMINAL_PANEL_ID, "set-tab-layout", { layout: next }).catch((err) => {
            setMirror("layout", next === "vertical" ? "horizontal" : "vertical");
            report("Layout not saved")(err);
        });
    };
    const copy = () => {
        setFailure(null);
        copySelection(currentSession()).catch(report("Nothing copied"));
    };
    const paste = () => {
        setFailure(null);
        pasteClipboard(currentSession()).catch(report("Nothing pasted"));
    };
    const copyLastOutput = () => {
        setFailure(null);
        const output = activeTerminals.get(currentSession())?.lastOutput();
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
            })
            .catch(report("Output not copied"));
    };

    // ── find ────────────────────────────────────────────────────────────────
    const [findOpen, setFindOpen] = createSignal(false);
    const [findQuery, setFindQuery] = createSignal("");
    const [findMissed, setFindMissed] = createSignal(false);
    let findInput: HTMLInputElement | undefined;
    const openFind = () => {
        setFindOpen(true);
        queueMicrotask(() => {
            findInput?.focus();
            findInput?.select();
        });
    };
    const find = (direction: -1 | 1) => {
        const handle = activeTerminals.get(currentSession());
        const query = findQuery();
        if (!handle || !query) {
            setFindMissed(false);
            return;
        }
        setFindMissed(!handle.find(query, direction));
    };
    const closeFind = () => {
        activeTerminals.get(currentSession())?.clearFind();
        setFindOpen(false);
        setFindMissed(false);
        activeTerminals.get(currentSession())?.focus();
    };
    // a find belongs to the screen it was made in
    createEffect(on(currentSession, (_now, before) => before && activeTerminals.get(before)?.clearFind(), { defer: true }));

    // ── a paste that would run commands as it lands ─────────────────────────
    const [pasteAsk, setPasteAsk] = createSignal<{ text: string; answer: (go: boolean) => void } | null>(null);
    const pasteCount = () => pasteLines(pasteAsk()?.text ?? "");
    const confirmPaste = (text: string) =>
        new Promise<boolean>((resolve) => {
            pasteAsk()?.answer(false);
            setPasteAsk({
                text,
                answer: (go) => {
                    setPasteAsk(null);
                    resolve(go);
                },
            });
        });
    const pastePreview = (text: string) => {
        const lines = text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/);
        const shown = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
        return lines.length > PASTE_PREVIEW_LINES ? `${shown}\n…` : shown;
    };

    const terminalMenu = useContextMenuState();
    const tabMenu = useContextMenuState();
    const savedMenu = useContextMenuState();
    const shellMenu = useContextMenuState();
    const splitMenu = useContextMenuState();
    const runSaved = async (id: string) => {
        setSavedRunError("");
        try {
            await actionsApi.call(TERMINAL_PANEL_ID, "run-saved-command", { id });
        } catch (err) {
            setSavedRunError(errorMessage(err));
            setIsSavedOpen(true);
        }
    };
    const openRenameModal = () => {
        const tid = contextTabId();
        if (!tid) return;
        tabMenu.close();
        const currentTab = tabs().find((t) => t.id === tid);
        setRenameValue(currentTab?.label || "");
        setRenameError("");
        setIsRenameOpen(true);
    };
    const closeRename = () => {
        setIsRenameOpen(false);
        setContextTabId(null);
    };
    const canRename = () => renameValue().trim() !== "" && !renaming();
    // the modal stays open until the service has the new name, so a refusal
    // is shown beside the field that caused it
    const handleSaveRename = async () => {
        const tid = contextTabId();
        if (!tid || !canRename()) return;
        setRenameError("");
        setRenaming(true);
        try {
            // the new label arrives through the service's state
            await actionsApi.call(TERMINAL_PANEL_ID, "rename-tab", { id: tid, label: renameValue().trim() });
            closeRename();
        } catch (err) {
            setRenameError(errorMessage(err));
        } finally {
            setRenaming(false);
        }
    };
    const contextTab = () => tabs().find((t) => t.id === contextTabId());

    // the screen of one shell in a tab
    const Pane = (paneProps: { tab: TerminalTab; session: string; class?: string }) => (
        <PaperFlex flex minWidth={0} minHeight={0} direction="column" class={paneProps.class}>
            <TerminalComponent
                id={paneProps.session}
                focused={activeTab() === paneProps.tab.id && focusedOf(paneProps.tab) === paneProps.session}
                onFocus={() => setFocusedPane(paneProps.tab.id, paneProps.session)}
                onContextMenu={terminalMenu.openAtMouse}
                onFailure={(shown) => setFailure(shown)}
                onActivity={() => noticeOutput(paneProps.session)}
                onBell={() => notice(paneProps.session, { bell: true })}
                onKeyAction={(action) => action === "find" && openFind()}
                confirmPaste={confirmPaste}
            />
        </PaperFlex>
    );

    // what sits after the tabs: new tab, its shells, split, saved commands, layout
    const Toolbar = () => (
        <PaperFlex direction="row" align="center" gap="half" paddingX="half" paddingY={vertical() ? "half" : undefined}>
            <PaperButton size="tiny" icon onClick={() => void addTab()} title="New Tab" aria-label="New Tab">
                <PaperIcon>add</PaperIcon>
            </PaperButton>
            <Show when={shells().length > 1}>
                <PaperButton
                    size="tiny"
                    icon
                    onClick={(e) => shellMenu.openBelow(e)}
                    title="New tab with another shell"
                    aria-label="New tab with another shell"
                    aria-haspopup="menu"
                    aria-expanded={shellMenu.isOpen()}
                >
                    <PaperIcon>expand_more</PaperIcon>
                </PaperButton>
            </Show>
            <PaperButton
                size="tiny"
                icon
                onClick={(e) => (shownTab()?.split ? unsplit(activeTab()) : splitMenu.openBelow(e))}
                title={shownTab()?.split ? "Close Split" : "Split"}
                aria-label={shownTab()?.split ? "Close Split" : "Split"}
                aria-haspopup={shownTab()?.split ? undefined : "menu"}
                aria-expanded={shownTab()?.split ? undefined : splitMenu.isOpen()}
                disabled={!shownTab()}
            >
                <PaperIcon>{shownTab()?.split ? "close_fullscreen" : "vertical_split"}</PaperIcon>
            </PaperButton>
            <PaperButton
                size="tiny"
                icon
                onClick={(e) => savedMenu.openBelow(e)}
                title="Saved commands"
                aria-label="Saved commands"
                aria-haspopup="menu"
                aria-expanded={savedMenu.isOpen()}
            >
                <PaperIcon>bookmarks</PaperIcon>
            </PaperButton>
            <PaperButton
                size="tiny"
                icon
                onClick={toggleLayout}
                title={vertical() ? "Tabs along the top" : "Tabs down the side"}
                aria-label={vertical() ? "Tabs along the top" : "Tabs down the side"}
            >
                <PaperIcon>{vertical() ? "top_panel_open" : "side_navigation"}</PaperIcon>
            </PaperButton>
        </PaperFlex>
    );

    return (
        <>
            <PaperFlex
                class="paperui-root unselectable"
                fullWidth
                fullHeight
                direction={vertical() ? "row" : "column"}
            >
                <Show when={tabs().length > 0}>
                <PaperList
                    reorderable
                    compact={vertical()}
                    direction={vertical() ? "vertical" : "horizontal"}
                    name="terminal-tabs"
                    value={activeTab()}
                    onValueChange={(val) => handleSwitchTab(String(val))}
                    onReorder={(newOrder) => {
                        const current = tabs();
                        const reordered = newOrder
                            .map((id) => current.find((item) => item.id === id)!)
                            .filter(Boolean);
                        // shown at once; the service's order is the truth, so a
                        // failed reorder pulls it back
                        setMirror("tabs", reordered);
                        setFailure(null);
                        actionsApi
                            .call(
                                TERMINAL_PANEL_ID,
                                "reorder-tabs",
                                { orderedIds: reordered.map((t) => t.id) },
                            )
                            .catch((err) => {
                                report("Tab order not saved", ". The tabs are back in their saved order.")(err);
                                void bridge
                                    .refreshState()
                                    .then((state) => applyTabs(state.tabs))
                                    .catch(report("Tabs not reloaded", ". This window may show an order the service doesn't have."));
                            });
                    }}
                >
                    <For each={tabs()}>
                        {(tab) => (
                            <PaperListItem
                                icon={attention[tab.id]?.bell ? "notifications_active" : "terminal"}
                                loaderStatus={statusOf(tab.id)}
                                value={tab.id}
                                title={folderOf(tab)}
                                onClosed={(closedId) => handleCloseTab(String(closedId))}
                                onContextMenu={(e: MouseEvent) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextTabId(tab.id);
                                    tabMenu.openAtMouse(e);
                                }}
                            >
                                {tabTitle(tab, mirror.live, focusedOf(tab))}
                            </PaperListItem>
                        )}
                    </For>
                    <Toolbar />
                </PaperList>
                </Show>
                <PaperFlex direction="column" flex minWidth={0} minHeight={0} fullHeight={vertical()}>
                    <Show when={failure()}>
                        {(shown) => (
                            <PaperFlex direction="column" fullWidth padding="half">
                                <PaperQuote
                                    variant="danger"
                                    icon="warning"
                                    title={shown().title}
                                    role="alert"
                                    onDismiss={() => setFailure(null)}
                                >
                                    {shown().message}
                                </PaperQuote>
                            </PaperFlex>
                        )}
                    </Show>
                    <Show when={findOpen()}>
                        <PaperFlex direction="row" align="center" gap="half" padding="half" fullWidth>
                            <PaperInput
                                compact
                                fullWidth
                                icon="search"
                                placeholder="Find"
                                aria-label="Find in this terminal"
                                invalid={findMissed()}
                                ref={(el: HTMLInputElement) => (findInput = el)}
                                value={findQuery()}
                                onInput={(e) => {
                                    setFindQuery(e.currentTarget.value);
                                    find(1);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
                                    else if (e.key === "Escape") closeFind();
                                }}
                            />
                            <Show when={findMissed()}>
                                <PaperText size={1} color="text-subtle" truncate>No matches</PaperText>
                            </Show>
                            <PaperButton size="tiny" icon onClick={() => find(-1)} title="Previous match" aria-label="Previous match">
                                <PaperIcon>keyboard_arrow_up</PaperIcon>
                            </PaperButton>
                            <PaperButton size="tiny" icon onClick={() => find(1)} title="Next match" aria-label="Next match">
                                <PaperIcon>keyboard_arrow_down</PaperIcon>
                            </PaperButton>
                            <PaperButton size="tiny" icon onClick={closeFind} title="Close find" aria-label="Close find">
                                <PaperIcon>close</PaperIcon>
                            </PaperButton>
                        </PaperFlex>
                    </Show>
                    <PaperFlex fullWidth flex minHeight={0} overflow="hidden" class={styles.stack}>
                        <Show when={hydration() === "failed"}>
                            <PaperFlex fullWidth fullHeight align="center" justify="center">
                                <PaperEmptyState
                                    icon="cloud_off"
                                    title="The terminal service is not answering"
                                    description={hydrationError()}
                                >
                                    <PaperButton variant="primary" onClick={() => void hydrate()}>
                                        <PaperIcon>refresh</PaperIcon> Try again
                                    </PaperButton>
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
                                        <Pane tab={tab} session={tab.id} />
                                        <Show when={tab.split}>
                                            {(shown) => {
                                                // read once: a split keeps its session, and a read
                                                // after the split closes would throw mid-update
                                                const session = shown().session.id;
                                                return (
                                                    <Pane
                                                        tab={tab}
                                                        session={session}
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
                </PaperFlex>
            </PaperFlex>
            <PaperContextMenu
                open={tabMenu.isOpen()}
                target={tabMenu.target()}
                placement={tabMenu.placement()}
                onClose={() => {
                    tabMenu.close();
                    if (!isRenameOpen()) setContextTabId(null);
                }}
            >
                <PaperContextMenuItem icon="edit" onClick={openRenameModal}>
                    Rename Tab
                </PaperContextMenuItem>
                <Show
                    when={contextTab()?.split}
                    fallback={
                        <>
                            <PaperContextMenuItem icon="splitscreen_right" onClick={() => { tabMenu.close(); split(contextTabId()!, "right"); }}>
                                Split Right
                            </PaperContextMenuItem>
                            <PaperContextMenuItem icon="splitscreen_bottom" onClick={() => { tabMenu.close(); split(contextTabId()!, "down"); }}>
                                Split Down
                            </PaperContextMenuItem>
                        </>
                    }
                >
                    <PaperContextMenuItem icon="close_fullscreen" onClick={() => { tabMenu.close(); unsplit(contextTabId()!); }}>
                        Close Split
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem icon="close" danger onClick={() => { tabMenu.close(); handleCloseTab(contextTabId()!); }}>
                    Close Tab
                </PaperContextMenuItem>
            </PaperContextMenu>
            <PaperContextMenu
                open={terminalMenu.isOpen()}
                target={terminalMenu.target()}
                placement={terminalMenu.placement()}
                onClose={terminalMenu.close}
            >
                <PaperContextMenuItem icon="content_copy" keybind={shortcutLabel("copy", MAC)} onClick={copy}>
                    Copy
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="content_paste" onClick={paste}>
                    Paste
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="output" onClick={copyLastOutput}>
                    Copy Last Output
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="search" keybind={shortcutLabel("find", MAC)} onClick={openFind}>
                    Find…
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="keyboard_arrow_up" keybind={shortcutLabel("previous-prompt", MAC)} onClick={() => activeTerminals.get(currentSession())?.jumpToPrompt(-1)}>
                    Previous Prompt
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="keyboard_arrow_down" keybind={shortcutLabel("next-prompt", MAC)} onClick={() => activeTerminals.get(currentSession())?.jumpToPrompt(1)}>
                    Next Prompt
                </PaperContextMenuItem>
                <Show
                    when={shownTab()?.split}
                    fallback={
                        <>
                            <PaperContextMenuItem icon="splitscreen_right" onClick={() => split(activeTab(), "right")}>
                                Split Right
                            </PaperContextMenuItem>
                            <PaperContextMenuItem icon="splitscreen_bottom" onClick={() => split(activeTab(), "down")}>
                                Split Down
                            </PaperContextMenuItem>
                        </>
                    }
                >
                    <PaperContextMenuItem icon="close_fullscreen" onClick={() => unsplit(activeTab())}>
                        Close Split
                    </PaperContextMenuItem>
                </Show>
            </PaperContextMenu>
            <PaperContextMenu
                open={splitMenu.isOpen()}
                target={splitMenu.target()}
                placement={splitMenu.placement()}
                onClose={splitMenu.close}
            >
                <PaperContextMenuItem icon="splitscreen_right" onClick={() => { splitMenu.close(); split(activeTab(), "right"); }}>
                    Split Right
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="splitscreen_bottom" onClick={() => { splitMenu.close(); split(activeTab(), "down"); }}>
                    Split Down
                </PaperContextMenuItem>
            </PaperContextMenu>
            <PaperContextMenu
                open={shellMenu.isOpen()}
                target={shellMenu.target()}
                placement={shellMenu.placement()}
                onClose={shellMenu.close}
            >
                <PaperContextMenuHeader>New tab with</PaperContextMenuHeader>
                <For each={shells()}>
                    {(shell, index) => (
                        <PaperContextMenuItem
                            value={shell.path}
                            icon="terminal"
                            description={shell.path}
                            keybind={index() === 0 ? "Default" : undefined}
                            onClick={() => {
                                shellMenu.close();
                                void addTab(shell.path);
                            }}
                        >
                            {shell.name}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>

            <PaperContextMenu
                open={savedMenu.isOpen()}
                target={savedMenu.target()}
                placement={savedMenu.placement()}
                onClose={savedMenu.close}
            >
                <PaperContextMenuHeader>Saved commands</PaperContextMenuHeader>
                <Show when={saved.savedCommandsError}>
                    <PaperContextMenuItem icon="error" disabled description={saved.savedCommandsError}>
                        Saved commands could not be read
                    </PaperContextMenuItem>
                </Show>
                <Show when={!saved.savedCommandsError && saved.savedCommands.length === 0}>
                    <PaperContextMenuItem icon="bookmarks" disabled>
                        No saved commands
                    </PaperContextMenuItem>
                </Show>
                <For each={saved.savedCommands}>
                    {(cmd) => (
                        <PaperContextMenuItem
                            value={cmd.id}
                            icon="play_arrow"
                            description={cmd.command}
                            keybind={describeRun(saved.commandRuns[cmd.id], Date.now()).value}
                            title={describeRun(saved.commandRuns[cmd.id], Date.now()).detail}
                            disabled={saved.commandRuns[cmd.id]?.state === "running"}
                            onClick={() => void runSaved(cmd.id)}
                        >
                            {cmd.label}
                        </PaperContextMenuItem>
                    )}
                </For>
                <PaperContextMenuItem
                    value="manage-saved-commands"
                    icon="edit"
                    onClick={() => {
                        setSavedRunError("");
                        setIsSavedOpen(true);
                    }}
                >
                    Manage saved commands…
                </PaperContextMenuItem>
            </PaperContextMenu>

            <SavedCommandsModal
                open={isSavedOpen()}
                runError={savedRunError()}
                onClose={() => {
                    setIsSavedOpen(false);
                    setSavedRunError("");
                }}
                commands={saved.savedCommands}
                runs={saved.commandRuns}
                loadError={saved.savedCommandsError}
            />

            <PaperModal
                open={pasteAsk() !== null}
                onClose={() => pasteAsk()?.answer(false)}
                title={pasteCount() === 1 ? "Paste 1 line?" : `Paste ${pasteCount()} lines?`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => pasteAsk()?.answer(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" onClick={() => pasteAsk()?.answer(true)} autofocus>Paste</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">{pasteCount() === 1 ? "It runs as a command as soon as it lands." : "Each line runs as a command as soon as it lands."}</PaperText>
                    <PaperCode block>{pastePreview(pasteAsk()?.text ?? "")}</PaperCode>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={isRenameOpen()}
                onClose={closeRename}
                title="Rename Tab"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={closeRename}>Cancel</PaperButton>
                        <PaperButton disabled={!canRename()} onClick={() => void handleSaveRename()}>
                            {renaming() ? "Saving…" : "Save"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperInput
                        fullWidth
                        label="Tab name"
                        value={renameValue()}
                        onInput={(e) => setRenameValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveRename();
                        }}
                        autofocus
                    />
                    <Show when={renameError()}>
                        <PaperQuote variant="danger" icon="warning" title="Tab not renamed" role="alert">
                            {renameError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
