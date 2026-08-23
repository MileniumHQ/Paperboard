import { createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperButton,
    PaperIcon,
    PaperModal,
    PaperInput,
    getVarCss,
    useContextMenuState,
    PaperContextMenu,
    PaperContextMenuItem,
} from "paperui";
import "paperui/style.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import TerminalComponent, { copySelection, pasteClipboard } from "./Terminal";

export default function App() {
    const [activeTab, setActiveTab] = createSignal("tab1");
    const [tabs, setTabs] = createSignal([{ id: "tab1", label: "Tab 1" }]);
    const [isRenameOpen, setIsRenameOpen] = createSignal(false);
    const [contextTabId, setContextTabId] = createSignal<string | null>(null);
    const [renameValue, setRenameValue] = createSignal("");
    let counter = 1;

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
    };

    const addTab = () => {
        counter++;
        const newId = `tab${counter}`;
        setTabs((prev) => [...prev, { id: newId, label: `Tab ${counter}` }]);
        setActiveTab(newId);
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
                    background: getVarCss("background-backest", "#0d0e12"),
                }}
            >
                <PaperList
                    reorderable
                    direction="horizontal"
                    name="terminal-tabs"
                    value={activeTab()}
                    onValueChange={(val) => setActiveTab(String(val))}
                    onReorder={(newOrder) => {
                        const current = tabs();
                        const reordered = newOrder
                            .map((id) => current.find((item) => item.id === id)!)
                            .filter(Boolean);
                        setTabs(reordered);
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
                    <PaperButton
                        tiny
                        icon
                        onClick={addTab}
                        title="New Tab"
                        style={{
                            "margin-left": getVarCss("uigap-half"),
                        }}
                    >
                        <PaperIcon>add</PaperIcon>
                    </PaperButton>
                </PaperList>

                <PaperFlex
                    fullWidth
                    style={{
                        flex: 1,
                        position: "relative",
                        overflow: "hidden",
                    }}
                >
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
                            compact
                            variant="text"
                        >
                            Cancel
                        </PaperButton>
                        <PaperButton onClick={handleSaveRename} compact>
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
