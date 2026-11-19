import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
    PAPER_PANEL_COMPACT_WIDTH,
    PaperFlex,
    PaperButton,
    PaperEffect,
    PaperEmptyState,
    PaperIcon,
    PaperQuote,
    useContextMenuState,
    copyText,
    createPaperMobile,
    showError,
    showToast,
    createPaperCompact,
    createRead,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { activeTerminals, copySelection, pasteClipboard } from "./Terminal";
import styles from "./Terminal.module.css";
import { terminalApi, type TerminalShell, errorMessage } from "@mileniumhq/paperapi";
import { terminal } from "./client";
import SavedCommands from "./SavedCommands";
import SoftKeys from "./SoftKeys";
import { createKeyRow } from "./lib/keyRow";
import { createAttention } from "./lib/attention";
import { createFind } from "./FindBar";
import { createPasteConfirm } from "./PasteConfirm";
import { createCloseConfirm } from "./CloseConfirm";
import { createRenameTab } from "./RenameTab";
import { ScreenMenu, ShellMenu, SplitMenu, TabMenu } from "./Menus";
import { TabBar, Toolbar } from "./TabBar";
import { SESSION_ERROR_TITLES, tabSessions, tabTitle } from "./lib/tabs";
import type { SessionErrorKind, SplitDirection, TabLayout, TerminalState, TerminalTab } from "./lib/contract";


export default function App() {
    const [activeTab, setActiveTab] = createSignal("");
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    // a tab action the service refused, said as a toast
    const report = (title: string, after = "") => (err: unknown) => showError(title, errorMessage(err) + after);
    // the tab list is the service's: every window on every computer mirrors
    // it, so a tab opened, renamed, moved or closed anywhere shows up here.
    // Keyed by id, so a tab keeps its object (and its live terminal) across
    // updates instead of remounting. Which tab is shown stays per window.
    // A push joins a read still out, being newer than it.
    const service = createRead(() => terminal.state.refresh(), {
        follow: (land) =>
            terminal.state.subscribe((full, patch) => {
                land((prev) => prev && { ...prev, ...patch });
                if (patch.live) attention.live(patch.live);
                if (opened()) followShow(full.showTab);
            }),
    });
    const tabs = () => service.value()?.tabs ?? [];
    const live = () => service.value()?.live ?? {};
    // unavailable is not empty, and unreadable tabs are not empty either:
    // no fresh tab opens over a service that did not answer, or over saved ones
    const tabsError = () => service.value()?.tabsError || null;
    const failed = () => (service.loading() ? null : service.error() ?? tabsError());
    const opened = createMemo(() => Boolean(service.value()) && !service.error() && !tabsError());
    // on a phone the tabs are always along the top: a side list would take
    // most of the width, and split shells share the one screen
    const compact = createPaperCompact();
    const mobile = createPaperMobile();
    // the tabs go down the side only where that leaves a split's two shells
    // room to work: a phone's width and a half. Narrower, they go along the top
    const sideQuery = window.matchMedia(`(min-width: ${PAPER_PANEL_COMPACT_WIDTH * 1.5}px)`);
    const [sideRoom, setSideRoom] = createSignal(sideQuery.matches);
    const sideChange = () => setSideRoom(sideQuery.matches);
    sideQuery.addEventListener("change", sideChange);
    onCleanup(() => sideQuery.removeEventListener("change", sideChange));
    const vertical = () => service.value()?.layout === "vertical" && sideRoom();

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
    const closeConfirm = createCloseConfirm();
    // the command each shell marked as running now, by session: what closing it would stop
    const [running, setRunning] = createStore<Record<string, string | null>>({});
    /** the commands running in these shells, as typed (or the program, when the shell didn't say the line) */
    const runningIn = (sessions: string[]) =>
        sessions.filter((id) => typeof running[id] === "string").map((id) => running[id] || live()[id]?.program || id);
    const rename = createRenameTab();

    // what went wrong for the shell in front where no one was waiting on it;
    // each stands while it is true, and this window can put it away. Keyed
    // by session, kind and message, so a row keeps its identity while it stands.
    const [putAway, setPutAway] = createStore<Record<string, true>>({});
    const sessionErrors = () => {
        const session = currentSession();
        return Object.entries(service.value()?.sessionErrors[session] ?? {})
            .map(([kind, message]) => [session, kind, message].join("\n"))
            .filter((key) => !putAway[key]);
    };
    const describeSessionError = (key: string) => {
        const [, kind, ...message] = key.split("\n");
        return { title: SESSION_ERROR_TITLES[kind as SessionErrorKind], message: message.join("\n") };
    };

    // Show Tab (a block) switches every open window; a window follows each
    // request once, and one made before it opened is already its first tab
    let followedShow = "";
    const followShow = (request: TerminalState["showTab"]) => {
        if (!request.request || request.request === followedShow) return;
        followedShow = request.request;
        if (tabs().some((t) => t.id === request.id)) setActiveTab(request.id);
    };
    // the shells this computer has, for a new tab's menu
    const [shells, setShells] = createSignal<TerminalShell[]>([]);
    const loadShells = () =>
        terminalApi
            .shells()
            .then(setShells)
            .catch(report("Shells not listed", ". New tabs start with this computer's default shell."));

    // the service answered: this window opens on its tab, lists the
    // computer's shells, and starts a shell when every tab is closed
    createEffect(
        on(opened, (now) => {
            if (!now) return;
            followedShow = service.value()!.showTab.request;
            if (!activeTab()) setActiveTab(service.value()!.activeTabId || tabs()[0]?.id || "");
            void loadShells();
            if (tabs().length === 0) void addTab();
        }),
    );

    // a tab closed in another window takes this window to a remaining one
    createEffect(
        on([opened, tabs, activeTab], ([ready, list, active]) => {
            if (!ready) return;
            if (!list.some((t) => t.id === active)) setActiveTab(list[0]?.id ?? "");
        }),
    );

    // a screen takes the keyboard once it is mounted and shown
    const focusSession = (id: string) => queueMicrotask(() => activeTerminals.get(id)?.focus());

    // a tab with a command running is closed only once its closing is agreed to
    const handleCloseTab = async (closedId: string) => {
        const closing = tabs().find((item) => item.id === closedId);
        if (!closing) return;
        const busy = runningIn(tabSessions(closing).map((s) => s.id));
        if (busy.length > 0 && !(await closeConfirm.confirm("tab", busy))) return;
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
        terminal.calls.closeTab({ id: closedId }).catch(report("Couldn't close the tab"));
    };
    // a new tab opens where you are: in the folder of the shell in front
    const addTab = async (shell?: string) => {
        try {
            const besides = currentSession();
            const id = await terminal.calls.createTab({ besides: besides || undefined, shell });
            // the state push travels beside this answer; pull it so the new
            // tab is listed before it is shown. The pull reaches onStateChange
            // above, and a push that lands meanwhile wins over it
            await terminal.state.refresh();
            setActiveTab(id);
            focusSession(id);
        } catch (err) {
            report("Couldn't open a tab")(err);
        }
    };
    const handleSwitchTab = (id: string) => {
        setActiveTab(id);
        // the last used tab is what the next window opens on
        terminal.calls
            .touchTab({ id })
            .catch(report("Couldn't remember the tab", ". The next window may open on another tab."));
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
        service.set((prev) => prev && { ...prev, tabs: reordered });
        terminal.calls
            .reorderTabs({ orderedIds: reordered.map((t) => t.id) })
            .catch((err) => {
                report("Couldn't save the tab order", ". The tabs are back in their saved order.")(err);
                terminal.state
                    .refresh()
                    .catch(report("Couldn't reload the tabs", ". This window may show an order the service doesn't have."));
            });
    };
    const split = (tabId: string, direction: SplitDirection) => {
        terminal.calls
            .splitTab({ id: tabId, direction })
            .then(async (pane) => {
                // the new shell is listed before it is shown
                await terminal.state.refresh();
                setFocusedPane(tabId, pane);
                focusSession(pane);
            })
            .catch(report("Couldn't split the tab"));
    };
    const unsplit = async (tabId: string) => {
        const pane = tabs().find((t) => t.id === tabId)?.split?.session.id;
        const busy = pane ? runningIn([pane]) : [];
        if (busy.length > 0 && !(await closeConfirm.confirm("split", busy))) return;
        terminal.calls.unsplitTab({ id: tabId }).catch(report("Couldn't close the split"));
    };
    const toggleLayout = () => {
        const next: TabLayout = vertical() ? "horizontal" : "vertical";
        // shown at once; the service's layout is the truth
        const setLayout = (layout: TabLayout) => service.set((prev) => prev && { ...prev, layout });
        setLayout(next);
        terminal.calls.setTabLayout({ layout: next }).catch((err) => {
            setLayout(next === "vertical" ? "horizontal" : "vertical");
            report("Couldn't save the layout")(err);
        });
    };
    // the phone shows no pointer or selection handles, so a copy says it happened
    const copied = (what: string) => mobile() && showToast({ title: `${what} copied`, variant: "success", duration: 1500 });
    const copy = () => {
        copySelection(currentSession()).then(() => copied("Selection"), report("Couldn't copy"));
    };
    const paste = () => {
        pasteClipboard(currentSession()).catch(report("Couldn't paste"));
    };
    const copyLastOutput = () => {
        const output = currentScreen()?.lastOutput();
        if (output === null || output === undefined) {
            showError("Couldn't copy the last output", "No command has finished in this shell yet. bash, zsh, fish and PowerShell mark their commands; sh and cmd don't.");
            return;
        }
        copyText(output)
            .then((ok) => {
                if (!ok) throw new Error("The clipboard refused the output.");
                copied("Last output");
            })
            .catch(report("Couldn't copy the last output"));
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
        if (tab) rename.open(tab.id, tab.named ? tab.label : tabTitle(tab, live()));
    };

    // a split's shells sit side by side, or stack when asked to or when the
    // panel is too narrow to share its width
    const directionOf = (tab: TerminalTab) => (compact() || tab.split?.direction === "down" ? "column" : "row");
    // the screen of one shell in a tab; a split's second shell keeps a floor
    // so dragging the line can't close it
    const Pane = (paneProps: { tab: TerminalTab; session: string; class?: string; floor?: boolean }) => (
        <PaperFlex
            flex
            minWidth={paneProps.floor ? "field" : 0}
            minHeight={paneProps.floor ? "field" : 0}
            direction="column"
            class={paneProps.class}
        >
            <TerminalComponent
                id={paneProps.session}
                focused={activeTab() === paneProps.tab.id && focusedOf(paneProps.tab) === paneProps.session}
                onFocus={() => setFocusedPane(paneProps.tab.id, paneProps.session)}
                onContextMenu={terminalMenu.openAtMouse}
                onActivity={() => attention.output(paneProps.session)}
                onBell={() => attention.bell(paneProps.session)}
                onRunning={(command) => setRunning(paneProps.session, command)}
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
                    {/* the buttons after the tabs stay where they are while the tabs scroll,
                        on the tab strip's own surface so the bar reads as one */}
                    <PaperFlex direction={vertical() ? "column" : "row"} align={vertical() ? undefined : "center"} fullHeight={vertical()} minWidth={0} minHeight={0} background="surface-inset">
                        <PaperFlex flex minWidth={0} minHeight={0}>
                            <TabBar
                                tabs={tabs()}
                                live={live()}
                                home={service.value()?.home ?? ""}
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
                            sideRoom={sideRoom()}
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
                    <Show when={sessionErrors().length > 0}>
                        <PaperFlex direction="column" gap="half" fullWidth padding="half">
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
                        <Show when={failed()}>
                            <PaperFlex fullWidth fullHeight align="center" justify="center">
                                <PaperEmptyState
                                    icon={tabsError() ? "error" : "cloud_off"}
                                    title={tabsError() ? "Your tabs couldn't be read" : "The terminal service is not answering"}
                                    description={failed()!}
                                >
                                    <Show when={!tabsError()}>
                                        <PaperButton variant="primary" onClick={() => void service.reload()}>
                                            <PaperIcon>refresh</PaperIcon> Try again
                                        </PaperButton>
                                    </Show>
                                </PaperEmptyState>
                            </PaperFlex>
                        </Show>
                        <Show when={opened() && tabs().length === 0}>
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
                                    <PaperFlex direction={directionOf(tab)} fullWidth fullHeight minHeight={0}>
                                        {/* the first shell is one pane whether or not a split sits beside it, so
                                            splitting never rebuilds its screen; the line between the two shells
                                            drags and each keeps a floor */}
                                        <PaperFlex
                                            direction={directionOf(tab)}
                                            resizable={!!tab.split}
                                            flex
                                            minWidth={tab.split ? "field" : 0}
                                            minHeight={tab.split ? "field" : 0}
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
                                                        class={directionOf(tab) === "column" ? styles.splitDown : styles.splitRight}
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
            <SavedCommands menu={savedMenu} commands={service.value()?.savedCommands ?? []} runs={service.value()?.commandRuns ?? {}} loadError={service.value()?.savedCommandsError ?? ""} />
            {pasteConfirm.modal}
            {closeConfirm.modal}
            {rename.modal}
        </>
    );
}
