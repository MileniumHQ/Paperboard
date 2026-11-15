// The panel's menus: a tab's, a screen's, Split's and New Tab's shells.
import { For, Show, type JSX } from "solid-js";
import { PaperContextMenu, PaperContextMenuHeader, PaperContextMenuItem, type useContextMenuState } from "@mileniumhq/paperui";
import type { TerminalShell } from "@mileniumhq/paperapi";
import { shortcutLabel } from "./keys";
import type { SplitDirection } from "./lib/contract";

export type MenuState = ReturnType<typeof useContextMenuState>;

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export function Menu(props: { state: MenuState; onClose?: () => void; children: JSX.Element }) {
    return (
        <PaperContextMenu
            open={props.state.isOpen()}
            target={props.state.target()}
            placement={props.state.placement()}
            onClose={() => (props.onClose ? props.onClose() : props.state.close())}
        >
            {props.children}
        </PaperContextMenu>
    );
}

/** Split Right and Split Down, or Close Split once it is split; a phone can only close one made elsewhere */
function SplitItems(props: { split: boolean; compact: boolean; onSplit: (direction: SplitDirection) => void; onUnsplit?: () => void }) {
    return (
        <Show
            when={props.split}
            fallback={
                <Show when={!props.compact}>
                    <PaperContextMenuItem icon="splitscreen_right" onClick={() => props.onSplit("right")}>
                        Split Right
                    </PaperContextMenuItem>
                    <PaperContextMenuItem icon="splitscreen_bottom" onClick={() => props.onSplit("down")}>
                        Split Down
                    </PaperContextMenuItem>
                </Show>
            }
        >
            <PaperContextMenuItem icon="close_fullscreen" onClick={() => props.onUnsplit?.()}>
                Close Split
            </PaperContextMenuItem>
        </Show>
    );
}

export function TabMenu(props: {
    state: MenuState;
    split: boolean;
    compact: boolean;
    onClose: () => void;
    onRename: () => void;
    onSplit: (direction: SplitDirection) => void;
    onUnsplit: () => void;
    onCloseTab: () => void;
}) {
    // each item acts on the tab the menu was opened on; the menu closes after it
    return (
        <Menu state={props.state} onClose={props.onClose}>
            <PaperContextMenuItem icon="edit" onClick={() => props.onRename()}>
                Rename Tab
            </PaperContextMenuItem>
            <SplitItems split={props.split} compact={props.compact} onSplit={props.onSplit} onUnsplit={props.onUnsplit} />
            <PaperContextMenuItem icon="close" danger onClick={() => props.onCloseTab()}>
                Close Tab
            </PaperContextMenuItem>
        </Menu>
    );
}

export function ScreenMenu(props: {
    state: MenuState;
    split: boolean;
    compact: boolean;
    onCopy: () => void;
    onPaste: () => void;
    onCopyLastOutput: () => void;
    onFind: () => void;
    onJump: (direction: -1 | 1) => void;
    onSplit: (direction: SplitDirection) => void;
    onUnsplit: () => void;
}) {
    const keybind = (action: Parameters<typeof shortcutLabel>[0]) => (props.compact ? undefined : shortcutLabel(action, MAC));
    return (
        <Menu state={props.state}>
            <PaperContextMenuItem icon="content_copy" keybind={keybind("copy")} onClick={() => props.onCopy()}>
                Copy
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="content_paste" onClick={() => props.onPaste()}>
                Paste
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="output" onClick={() => props.onCopyLastOutput()}>
                Copy Last Output
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="search" keybind={keybind("find")} onClick={() => props.onFind()}>
                Find…
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="keyboard_arrow_up" keybind={keybind("previous-prompt")} onClick={() => props.onJump(-1)}>
                Previous Prompt
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="keyboard_arrow_down" keybind={keybind("next-prompt")} onClick={() => props.onJump(1)}>
                Next Prompt
            </PaperContextMenuItem>
            <SplitItems split={props.split} compact={props.compact} onSplit={props.onSplit} onUnsplit={props.onUnsplit} />
        </Menu>
    );
}

export function SplitMenu(props: { state: MenuState; onSplit: (direction: SplitDirection) => void }) {
    return (
        <Menu state={props.state}>
            <SplitItems split={false} compact={false} onSplit={props.onSplit} />
        </Menu>
    );
}

export function ShellMenu(props: { state: MenuState; shells: TerminalShell[]; onPick: (path: string) => void }) {
    return (
        <Menu state={props.state}>
            <PaperContextMenuHeader>New tab with</PaperContextMenuHeader>
            <For each={props.shells}>
                {(shell, index) => (
                    <PaperContextMenuItem
                        value={shell.path}
                        icon="terminal"
                        description={shell.path}
                        keybind={index() === 0 ? "Default" : undefined}
                        onClick={() => props.onPick(shell.path)}
                    >
                        {shell.name}
                    </PaperContextMenuItem>
                )}
            </For>
        </Menu>
    );
}
