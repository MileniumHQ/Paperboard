import { createSignal, For } from "solid-js";
import {
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperButton,
    PaperIcon,
    getVar,
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

    return (
        <>
            <PaperFlex
                class="paperui-root"
                fullWidth
                fullHeight
                direction="column"
                style={{
                    background: "var(--paper-background-backest, #0d0e12)",
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
                            .map(
                                (id) => current.find((item) => item.id === id)!,
                            )
                            .filter(Boolean);
                        setTabs(reordered);
                    }}
                >
                    <For each={tabs()}>
                        {(tab) => (
                            <PaperListItem
                                icon="terminal"
                                value={tab.id}
                                onClosed={(closedId) => {
                                    handleCloseTab(String(closedId));
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
                            "margin-left": getVar("--paper-uigap-half"),
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
                                    display:
                                        activeTab() === tab.id
                                            ? "flex"
                                            : "none",
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
        </>
    );
}
