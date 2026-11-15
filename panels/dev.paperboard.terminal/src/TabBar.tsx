// The tabs, along the top or down the side, and the buttons after them: new
// tab, its shells, split, saved commands, layout. A split's second shell is
// listed under its tab, to pick or close.
import { For, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperIcon, PaperList, PaperListItem, type LoaderStatus } from "@mileniumhq/paperui";
import type { MenuState } from "./Menus";
import { shortTitle, tabTitle } from "./lib/tabs";
import styles from "./Terminal.module.css";
import type { LiveSession, TerminalSession, TerminalTab } from "./lib/contract";

export function TabBar(props: {
    tabs: TerminalTab[];
    live: Record<string, LiveSession>;
    vertical: boolean;
    /** the session picked: the focused shell of the tab in front */
    value: string;
    status: (tabId: string) => LoaderStatus | undefined;
    rang: (tabId: string) => boolean;
    onChoose: (session: string) => void;
    onReorder: (ids: string[]) => void;
    onCloseTab: (tabId: string) => void;
    onUnsplit: (tabId: string) => void;
    onMenu: (e: MouseEvent, tabId: string) => void;
}) {
    const folderOf = (session: TerminalSession) => props.live[session.id]?.cwd || session.cwd || "";
    return (
        <PaperList
            reorderable
            class={props.vertical ? undefined : styles.tabs}
            compact={props.vertical}
            direction={props.vertical ? "vertical" : "horizontal"}
            name="terminal-tabs"
            value={props.value}
            onValueChange={(val) => props.onChoose(String(val))}
            onReorder={(ids) => props.onReorder(ids.map(String))}
        >
            <For each={props.tabs}>
                {(tab) => (
                    <>
                        <PaperListItem
                            icon={props.rang(tab.id) ? "notifications_active" : "terminal"}
                            loaderStatus={props.status(tab.id)}
                            value={tab.id}
                            title={props.vertical ? folderOf(tab) : [tabTitle(tab, props.live, tab.id), folderOf(tab)].filter(Boolean).join("\n")}
                            onClosed={(closedId) => props.onCloseTab(String(closedId))}
                            onContextMenu={(e: MouseEvent) => props.onMenu(e, tab.id)}
                        >
                            {props.vertical ? tabTitle(tab, props.live, tab.id) : shortTitle(tabTitle(tab, props.live, tab.id))}
                        </PaperListItem>
                        <Show when={tab.split}>
                            {(shown) => {
                                // read once: a split keeps its session, and a read
                                // after the split closes would throw mid-update
                                const session = shown().session;
                                return (
                                    <PaperListItem
                                        icon="subdirectory_arrow_right"
                                        value={session.id}
                                        title={folderOf(session)}
                                        aria-label={`${tab.label}, second shell`}
                                        onClosed={() => props.onUnsplit(tab.id)}
                                        onContextMenu={(e: MouseEvent) => props.onMenu(e, tab.id)}
                                    >
                                        {props.live[session.id]?.program || tab.label}
                                    </PaperListItem>
                                );
                            }}
                        </Show>
                    </>
                )}
            </For>
        </PaperList>
    );
}

export function Toolbar(props: {
    vertical: boolean;
    compact: boolean;
    /** the tab in front, if there is one, and whether it is split */
    shown: TerminalTab | undefined;
    manyShells: boolean;
    shellMenu: MenuState;
    splitMenu: MenuState;
    savedMenu: MenuState;
    onNewTab: () => void;
    onUnsplit: () => void;
    onToggleLayout: () => void;
}) {
    const split = () => Boolean(props.shown?.split);
    return (
        <PaperFlex direction="row" align="center" gap="half" paddingX="half" paddingY={props.vertical ? "half" : undefined}>
            <PaperButton size="tiny" icon onClick={() => props.onNewTab()} title="New Tab" aria-label="New Tab">
                <PaperIcon>add</PaperIcon>
            </PaperButton>
            <Show when={props.manyShells}>
                <PaperButton
                    size="tiny"
                    icon
                    onClick={(e) => props.shellMenu.openBelow(e)}
                    title="New tab with another shell"
                    aria-label="New tab with another shell"
                    aria-haspopup="menu"
                    aria-expanded={props.shellMenu.isOpen()}
                >
                    <PaperIcon>expand_more</PaperIcon>
                </PaperButton>
            </Show>
            {/* a split is for a computer's screen; a phone can only close one made elsewhere */}
            <Show when={!props.compact || split()}>
                <PaperButton
                    size="tiny"
                    icon
                    onClick={(e) => (split() ? props.onUnsplit() : props.splitMenu.openBelow(e))}
                    title={split() ? "Close Split" : "Split"}
                    aria-label={split() ? "Close Split" : "Split"}
                    aria-haspopup={split() ? undefined : "menu"}
                    aria-expanded={split() ? undefined : props.splitMenu.isOpen()}
                    disabled={!props.shown}
                >
                    <PaperIcon>{split() ? "close_fullscreen" : "vertical_split"}</PaperIcon>
                </PaperButton>
            </Show>
            <PaperButton
                size="tiny"
                icon
                onClick={(e) => props.savedMenu.openBelow(e)}
                title="Saved commands"
                aria-label="Saved commands"
                aria-haspopup="menu"
                aria-expanded={props.savedMenu.isOpen()}
            >
                <PaperIcon>bookmarks</PaperIcon>
            </PaperButton>
            <Show when={!props.compact}>
                <PaperButton
                    size="tiny"
                    icon
                    onClick={() => props.onToggleLayout()}
                    title={props.vertical ? "Tabs along the top" : "Tabs down the side"}
                    aria-label={props.vertical ? "Tabs along the top" : "Tabs down the side"}
                >
                    <PaperIcon>{props.vertical ? "top_panel_open" : "side_navigation"}</PaperIcon>
                </PaperButton>
            </Show>
        </PaperFlex>
    );
}
