import { type Component, For, Show } from "solid-js";
import { createFailureToast, PaperButton, PaperEmptyState, PaperFlex, PaperList, PaperListItem, getVarCss } from "@mileniumhq/paperui";
import { problemsApi, type InvalidPanel, type PanelItem } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import { followPanelProblems } from "../../lib/panelProblems";
import ComputerHeader from "./ComputerHeader";
import PanelIcon from "./PanelIcon";
import PanelProblems from "./PanelProblems";
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
// and its installed panels, and what went wrong with each panel. A switch
// or a list that failed, and a panel that can't load, are toasts while the
// column is the active one; a column with no panels to show for it says
// "Couldn't load" with Try again.
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
                const problems = followPanelProblems(comp.id, () => comp.name, () => props.panelsLoadError[comp.id] === "");
                const active = () => props.activeComputerId === comp.id;
                const switchFailed = () => props.switchError[comp.id];
                const listFailed = () => !switchFailed() && props.panelsLoadError[comp.id];
                const retry = () => (switchFailed() ? props.onRetrySwitch(comp.id) : props.onRetryPanels(comp.id));
                createFailureToast(() => active() && switchFailed(), {
                    title: `Couldn't switch to ${comp.name}`,
                    action: { label: "Try again", onClick: retry },
                });
                createFailureToast(() => active() && listFailed(), {
                    title: `Couldn't list ${comp.name}'s panels`,
                    action: { label: "Try again", onClick: retry },
                });
                // installed panels the computer refuses, each with why
                createFailureToast(
                    () => active() && (props.invalidPanelsByComputer[comp.id] ?? []).map((broken) => `${broken.id}: ${broken.error}`).join(" "),
                    { title: `Couldn't load panels on ${comp.name}` },
                );
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
                                        icon={
                                            <span class={styles.panelIcon}>
                                                <PanelIcon computerId={comp.id} panel={panel} />
                                                <PanelProblems
                                                    panelName={panel.name}
                                                    problems={problems(panel.id)}
                                                    onDismiss={(key) => problemsApi.clear(panel.id, key, comp.id)}
                                                />
                                            </span>
                                        }
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
                            <Show when={panels().length === 0 && (switchFailed() || listFailed())}>
                                <PaperEmptyState icon="error" title="Couldn't load">
                                    <PaperButton onClick={retry}>Try again</PaperButton>
                                </PaperEmptyState>
                            </Show>
                        </PaperList>
                    </PaperFlex>
                );
            }}
        </For>
    </PaperFlex>
);

export default ComputerSidebar;
