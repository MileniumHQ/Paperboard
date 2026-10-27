import { createEffect, createSignal, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperButton,
    PaperEffect,
    PaperEmptyState,
    PaperIcon,
    PaperModal,
    PaperInput,
    PaperQuote,
    useContextMenuState,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuHeader,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { copySelection, pasteClipboard } from "./Terminal";
import styles from "./Terminal.module.css";
import { actions as actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { onMount } from "solid-js";
import SavedCommandsModal from "./SavedCommands";
import type { CommandRun, SavedCommand } from "./lib/savedCommands";
import { describeRun } from "./lib/runStatus";
import { errorMessage, type Outcome } from "./lib/failure";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export interface TerminalTab {
    id: string;
    label: string;
}

interface TerminalBridgeState {
    tabs: TerminalTab[];
    activeTabId: string;
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    savedCommandsError: string;
}

const bridge = createPanelBridge<TerminalBridgeState>({
    panelId: TERMINAL_PANEL_ID,
    defaultState: { tabs: [], activeTabId: "", savedCommands: [], commandRuns: {}, savedCommandsError: "" },
});

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
    const [mirror, setMirror] = createStore<{ tabs: TerminalTab[] }>({ tabs: [] });
    const tabs = () => mirror.tabs;
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
    bridge.onStateChange((patch, full) => {
        applyTabs(patch.tabs);
        applySaved(full);
    });

    const hydrate = async () => {
        setHydration("loading");
        try {
            const state = await bridge.refreshState();
            applyTabs(state.tabs);
            if (!activeTab()) setActiveTab(state.activeTabId || tabs()[0]?.id || "");
            setHydration("ready");
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

    const addTab = async () => {
        setFailure(null);
        try {
            const id = await actionsApi.call<string>(
                TERMINAL_PANEL_ID,
                "create-tab",
                {},
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

    const copy = () => {
        setFailure(null);
        copySelection(activeTab()).catch(report("Nothing copied"));
    };

    const paste = () => {
        setFailure(null);
        pasteClipboard(activeTab()).catch(report("Nothing pasted"));
    };

    const terminalMenu = useContextMenuState();
    const tabMenu = useContextMenuState();
    const savedMenu = useContextMenuState();

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

    return (
        <>
            <PaperFlex
                class="paperui-root unselectable"
                fullWidth
                fullHeight
                direction="column"
            >
                <Show when={tabs().length > 0}>
                <PaperList
                    reorderable
                    direction="horizontal"
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
                                icon="terminal"
                                value={tab.id}
                                onClosed={(closedId) => handleCloseTab(String(closedId))}
                                onContextMenu={(e: MouseEvent) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextTabId(tab.id);
                                    tabMenu.openAtMouse(e);
                                }}
                            >
                                {tab.label}
                            </PaperListItem>
                        )}
                    </For>
                    <PaperButton size="tiny"
                        icon
                        onClick={addTab}
                        title="New Tab"
                        aria-label="New Tab">
                        <PaperIcon>add</PaperIcon>
                    </PaperButton>
                    <PaperButton size="tiny"
                        icon
                        onClick={(e) => savedMenu.openBelow(e)}
                        title="Saved commands"
                        aria-label="Saved commands"
                        aria-haspopup="menu"
                        aria-expanded={savedMenu.isOpen()}>
                        <PaperIcon>bookmarks</PaperIcon>
                    </PaperButton>
                </PaperList>
                </Show>

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
                                    <PaperButton variant="primary" onClick={addTab}>
                                        <PaperIcon>add</PaperIcon> New Tab
                                    </PaperButton>
                                </PaperEffect>
                            </PaperEmptyState>
                        </PaperFlex>
                    </Show>
                    <For each={tabs()}>
                        {(tab) => (
                            <div classList={{ [styles.layer]: true, [styles.hidden]: activeTab() !== tab.id }}>
                                <TerminalComponent
                                    id={tab.id}
                                    onContextMenu={terminalMenu.openAtMouse}
                                    onFailure={(shown) => setFailure(shown)}
                                />
                            </div>
                        )}
                    </For>
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
            </PaperContextMenu>

            <PaperContextMenu
                open={terminalMenu.isOpen()}
                target={terminalMenu.target()}
                placement={terminalMenu.placement()}
                onClose={terminalMenu.close}
            >
                <PaperContextMenuItem
                    icon="content_copy"
                    onClick={copy}
                >
                    Copy
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    icon="content_paste"
                    onClick={paste}
                >
                    Paste
                </PaperContextMenuItem>
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
