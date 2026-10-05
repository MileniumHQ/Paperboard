import { createSignal, For, Show } from "solid-js";
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
import { actions as actionsApi } from "@mileniumhq/paperapi";
import { onMount } from "solid-js";

const TERMINAL_PANEL_ID = "dev.paperboard.terminal";

export interface TerminalTab {
    id: string;
    label: string;
}

export default function App() {
    const [activeTab, setActiveTab] = createSignal("");
    const [tabs, setTabs] = createSignal<TerminalTab[]>([]);
    const [isRenameOpen, setIsRenameOpen] = createSignal(false);
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    const [renameValue, setRenameValue] = createSignal("");

    onMount(async () => {
        try {
            const listed = await actionsApi.call<TerminalTab[]>(
                TERMINAL_PANEL_ID,
                "list-tabs",
            );
            if (listed && listed.length > 0) {
                setTabs(listed);
                setActiveTab(listed[0].id);
                return;
            }
        } catch (err) {
            console.debug("[terminal] list-tabs failed:", String(err));
        }
        try {
            const id = await actionsApi.call<string>(
                TERMINAL_PANEL_ID,
                "create-tab",
                { label: "Tab 1" },
            );
            if (id) {
                setTabs([{ id, label: "Tab 1" }]);
                setActiveTab(id);
            }
        } catch (err) {
            console.debug("[terminal] create-tab failed:", String(err));
        }
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

        setTabs(current.filter((item) => item.id !== closedId));
        actionsApi.call(TERMINAL_PANEL_ID, "close-tab", { id: closedId }).catch((err) =>
            console.debug("[terminal] close-tab failed:", String(err)),
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
            const listed = await actionsApi
                .call<TerminalTab[]>(TERMINAL_PANEL_ID, "list-tabs")
                .catch((err) => {
                    console.debug("[terminal] list-tabs failed:", String(err));
                    return [] as TerminalTab[];
                });
            const label =
                listed.find((t) => t.id === id)?.label || `Tab ${tabs().length + 1}`;
            setTabs((prev) => [...prev, { id, label }]);
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
            setTabs((prev) =>
                prev.map((t) => (t.id === tid ? { ...t, label: newName } : t)),
            );
            actionsApi
                .call(TERMINAL_PANEL_ID, "rename-tab", { id: tid, label: newName })
                .catch((err) =>
                    console.debug("[terminal] rename-tab failed:", String(err)),
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
                        setTabs(reordered);
                        // persistence lives in the service — a silent local
                        // reorder would reset on restart
                        actionsApi
                            .call(
                                TERMINAL_PANEL_ID,
                                "reorder-tabs",
                                { orderedIds: reordered.map((t) => t.id) },
                            )
                            .catch((err) =>
                                console.error("[Terminal] reorder persist failed:", err),
                            );
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
                    <Show when={tabs().length === 0}>
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
