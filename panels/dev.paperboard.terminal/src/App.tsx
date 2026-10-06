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
    getVarCss,
    useContextMenuState,
    PaperContextMenu,
    PaperContextMenuItem,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { copySelection, pasteClipboard } from "./Terminal";
import { actions as actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { onMount } from "solid-js";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export interface TerminalTab {
    id: string;
    label: string;
}

const bridge = createPanelBridge<{ tabs: TerminalTab[]; activeTabId: string }>({
    panelId: TERMINAL_PANEL_ID,
    defaultState: { tabs: [], activeTabId: "" },
});

export default function App() {
    const [activeTab, setActiveTab] = createSignal("");
    const [isRenameOpen, setIsRenameOpen] = createSignal(false);
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    const [renameValue, setRenameValue] = createSignal("");
    const [hydration, setHydration] = createSignal<"loading" | "ready" | "failed">("loading");
    const [hydrationError, setHydrationError] = createSignal("");

    // the tab list is the service's: every window on every computer mirrors
    // it, so a tab opened, renamed, moved or closed anywhere shows up here.
    // Keyed by id, so a tab keeps its object (and its live terminal) across
    // updates instead of remounting. Which tab is shown stays per window.
    const [mirror, setMirror] = createStore<{ tabs: TerminalTab[] }>({ tabs: [] });
    const tabs = () => mirror.tabs;
    const applyTabs = (next: unknown) => {
        if (Array.isArray(next)) setMirror("tabs", reconcile(next as TerminalTab[], { key: "id" }));
    };
    bridge.onStateChange((patch) => applyTabs(patch.tabs));

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
            setHydrationError(err instanceof Error ? err.message : String(err));
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
        actionsApi.call(TERMINAL_PANEL_ID, "close-tab", { id: closedId }).catch((err) =>
            console.error("[terminal] close-tab failed:", String(err)),
        );
    };

    const addTab = async () => {
        try {
            const id = await actionsApi.call<string>(
                TERMINAL_PANEL_ID,
                "create-tab",
                {},
            );
            if (!id) return;
            // the state push travels beside this answer; pull it so the new
            // tab is listed before it is shown
            applyTabs((await bridge.refreshState()).tabs);
            setActiveTab(id);
        } catch (err) {
            console.warn("[terminal] create-tab failed:", String(err));
        }
    };

    const handleSwitchTab = (id: string) => {
        setActiveTab(id);
        actionsApi.call(TERMINAL_PANEL_ID, "touch-tab", { id }).catch((err) =>
            console.debug("[terminal] touch-tab failed:", String(err)),
        );
    };

    const terminalMenu = useContextMenuState();
    const tabMenu = useContextMenuState();

    const openRenameModal = () => {
        const tid = contextTabId();
        if (!tid) return;
        tabMenu.close();
        const currentTab = tabs().find((t) => t.id === tid);
        setRenameValue(currentTab?.label || "");
        setIsRenameOpen(true);
    };

    const handleSaveRename = () => {
        const tid = contextTabId();
        const newName = renameValue().trim();
        if (tid && newName) {
            // the new label arrives through the service's state
            actionsApi
                .call(TERMINAL_PANEL_ID, "rename-tab", { id: tid, label: newName })
                .catch((err) =>
                    console.error("[terminal] rename-tab failed:", String(err)),
                );
        }
        setIsRenameOpen(false);
        setContextTabId(null);
    };

    return (
        <>
            <PaperFlex
                class="paperui-root unselectable"
                fullWidth
                fullHeight
                direction="column"
                style={{
                    background: getVarCss("surface-app", "#0d0e12"),
                }}
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
                        actionsApi
                            .call(
                                TERMINAL_PANEL_ID,
                                "reorder-tabs",
                                { orderedIds: reordered.map((t) => t.id) },
                            )
                            .catch((err) => {
                                console.error("[Terminal] reorder persist failed:", err);
                                void bridge
                                    .refreshState()
                                    .then((state) => applyTabs(state.tabs))
                                    .catch((refreshErr) =>
                                        console.error("[Terminal] tab list refresh failed:", refreshErr),
                                    );
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
                        style={{
                            "margin-left": getVarCss("uigap-half"),
                        }}>
                        <PaperIcon>add</PaperIcon>
                    </PaperButton>
                </PaperList>
                </Show>

                <PaperFlex
                    fullWidth
                    style={{
                        flex: 1,
                        position: "relative",
                        overflow: "hidden",
                    }}
                >
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
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    display: activeTab() === tab.id ? "flex" : "none",
                                    "flex-direction": "column",
                                }}
                            >
                                <TerminalComponent
                                    id={tab.id}
                                    onContextMenu={terminalMenu.openAtMouse}
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
                    onClick={() => copySelection(activeTab())}
                >
                    Copy
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    icon="content_paste"
                    onClick={() => pasteClipboard(activeTab())}
                >
                    Paste
                </PaperContextMenuItem>
            </PaperContextMenu>

            <PaperModal
                open={isRenameOpen()}
                onClose={() => {
                    setIsRenameOpen(false);
                    setContextTabId(null);
                }}
                title="Rename Tab"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            onClick={() => {
                                setIsRenameOpen(false);
                                setContextTabId(null);
                            }}
                            variant="text">
                            Cancel
                        </PaperButton>
                        <PaperButton onClick={handleSaveRename}>
                            Save
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <Show when={isRenameOpen()}>
                    <PaperFlex direction="column" gap="half">
                        <PaperInput
                            fullWidth
                            placeholder="Tab Name"
                            value={renameValue()}
                            onInput={(e) => setRenameValue(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename();
                                if (e.key === "Escape") {
                                    setIsRenameOpen(false);
                                    setContextTabId(null);
                                }
                            }}
                            autofocus
                        />
                    </PaperFlex>
                </Show>
            </PaperModal>
        </>
    );
}
