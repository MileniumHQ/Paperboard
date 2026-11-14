import { type Component, For, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperList, PaperListItem, PaperQuote, getVarCss } from "@mileniumhq/paperui";
import type { InvalidPanel, PanelItem } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import ComputerHeader from "./ComputerHeader";
import PanelIcon from "./PanelIcon";
import styles from "./ComputerSidebar.module.css";

export interface ComputerSidebarProps {
    computers: ComputerInfo[];
    activeComputerId: string;
    selectedTab: (computerId: string) => string;
    onSelectTab: (computerId: string, tab: string) => void;
    /** a tab was chosen: the phone layout opens it as a page */
    onActivateTab: () => void;
    panelsByComputer: Record<string, PanelItem[]>;
    invalidPanelsByComputer: Record<string, InvalidPanel[]>;
    /** `computerId::panelId` of the panels whose new release is installing; they can't be opened */
    updatingPanels: Set<string>;
    /** why a computer couldn't be made the active one, by computer */
    switchError: Record<string, string>;
    onRetrySwitch: (computerId: string) => void;
    /** why a computer's panels couldn't be listed, by computer ("" once they are) */
    panelsLoadError: Record<string, string>;
    onRetryPanels: (computerId: string) => void;
    onPanelContextMenu: (computerId: string, panel: PanelItem, event: MouseEvent) => void;
    onLibraryContextMenu: (event: MouseEvent) => void;
    /** the phone layout: it fills the screen beside the rail, and its rows are buttons */
    mobile: boolean;
    inert: boolean;
}

// The active computer's column beside the rail: its header (info, library)
// and its installed panels, with what couldn't be listed or switched to.
// Every computer keeps its column, hidden while another is active, so a
// switch back finds its list as it was left.
const ComputerSidebar: Component<ComputerSidebarProps> = (props) => (
    <PaperFlex
        direction="column"
        background="surface-inset"
        inert={props.inert}
        fullHeight
        shrink={0}
        overflow="hidden"
        class={styles.sidebar}
        classList={{ [styles.phone]: props.mobile }}
    >
        <For each={props.computers}>
            {(comp) => {
                const tab = () => props.selectedTab(comp.id);
                const panels = () => props.panelsByComputer[comp.id] || [];
                const updating = (panel: PanelItem) => props.updatingPanels.has(`${comp.id}::${panel.id}`);
                return (
                    <PaperFlex
                        direction="column"
                        fullWidth
                        fullHeight
                        gap={getVarCss("border-width")}
                        overflow="hidden"
                        class={styles.computerColumn}
                        hidden={props.activeComputerId !== comp.id}
                    >
                        <ComputerHeader
                            computer={comp}
                            selectedTab={tab()}
                            onSelectTab={(next) => props.onSelectTab(comp.id, next)}
                            onActivateTab={props.onActivateTab}
                            buttons={props.mobile}
                            onLibraryContextMenu={props.onLibraryContextMenu}
                        />

                        <PaperList
                            name={`installed-panel-${comp.id}`}
                            value={tab()}
                            onValueChange={(val) => props.onSelectTab(comp.id, String(val))}
                            buttons={props.mobile}
                            class={styles.panelList}
                        >
                            <For each={panels()}>
                                {(panel) => (
                                    <PaperListItem
                                        value={panel.id}
                                        disabled={updating(panel)}
                                        title={updating(panel) ? `${panel.name} is updating` : undefined}
                                        onClick={props.onActivateTab}
                                        icon={<PanelIcon computerId={comp.id} panel={panel} />}
                                        onContextMenu={(e: MouseEvent) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            props.onPanelContextMenu(comp.id, panel, e);
                                        }}
                                    >
                                        {panel.name}
                                    </PaperListItem>
                                )}
                            </For>
                            <For each={props.invalidPanelsByComputer[comp.id] ?? []}>
                                {(broken) => (
                                    <PaperFlex direction="column" padding="half">
                                        <PaperQuote variant="danger" icon="error" title="Panel can't load" role="alert">
                                            {`${broken.id}: ${broken.error}`}
                                        </PaperQuote>
                                    </PaperFlex>
                                )}
                            </For>
                            <Show when={props.switchError[comp.id]}>
                                <PaperFlex direction="column" padding="half">
                                    <PaperQuote variant="danger" icon="warning" title="Computer not switched" role="alert">
                                        <PaperFlex direction="column" gap="half" align="flex-start">
                                            {props.switchError[comp.id]}
                                            <PaperButton size="tiny" onClick={() => props.onRetrySwitch(comp.id)}>
                                                Retry
                                            </PaperButton>
                                        </PaperFlex>
                                    </PaperQuote>
                                </PaperFlex>
                            </Show>
                            <Show when={!props.switchError[comp.id] && props.panelsLoadError[comp.id] && panels().length === 0}>
                                <PaperFlex direction="column" padding="half">
                                    <PaperQuote variant="danger" icon="warning" title="Panels not loaded" role="alert">
                                        <PaperFlex direction="column" gap="half" align="flex-start">
                                            {props.panelsLoadError[comp.id]}
                                            <PaperButton size="tiny" onClick={() => props.onRetryPanels(comp.id)}>
                                                Retry
                                            </PaperButton>
                                        </PaperFlex>
                                    </PaperQuote>
                                </PaperFlex>
                            </Show>
                        </PaperList>
                    </PaperFlex>
                );
            }}
        </For>
    </PaperFlex>
);

export default ComputerSidebar;
