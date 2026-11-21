import { type Component } from "solid-js";
import {
    PaperList,
    PaperListItem,
    PaperFlex,
} from "@mileniumhq/paperui";
import styles from "./ComputerHeader.module.css";
import iconStyles from "./panelIcon.module.css";
import libraryIcon from "../../assets/PanelLibrary.png";
import type { ComputerInfo } from "../../lib/shell";
import { computerLook } from "./osBrand";

export interface ComputerHeaderProps {
    computer?: ComputerInfo;
    selectedTab: string;
    onSelectTab: (tab: string) => void;
    /** a tab was tapped, even the one already selected (the phone layout opens it) */
    onActivateTab?: () => void;
    /** Opens the library's right-click menu (Reload), anchored at the event. */
    onLibraryContextMenu?: (e: MouseEvent) => void;
    /** the phone layout: what a tab opens covers the list, so none stays highlighted */
    buttons?: boolean;
}

const ComputerHeader: Component<ComputerHeaderProps> = (props) => {
    const look = () => computerLook(props.computer);

    return (
        <PaperFlex
            direction="column"
            background="surface-inset"
            shrink={0}
            class={styles.header}
        >
            <PaperList
                name="computer-system-selection"
                value={props.selectedTab}
                onValueChange={(val) => props.onSelectTab(String(val))}
                buttons={props.buttons}
                class={styles.tabs}
            >
                <PaperListItem
                    value="settings"
                    onClick={() => props.onActivateTab?.()}
                    description={look().line}
                    class={styles.computerItem}
                    style={{ "--computer-os-color": look().color }}
                >
                    {props.computer?.name || "This Computer"}
                </PaperListItem>

                <PaperListItem
                    value="library"
                    onClick={() => props.onActivateTab?.()}
                    onContextMenu={(e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        props.onLibraryContextMenu?.(e);
                    }}
                    icon={
                        <img src={libraryIcon} alt="Panel Library" class={iconStyles.panelIcon} />
                    }
                >
                    Panel Library
                </PaperListItem>
            </PaperList>
        </PaperFlex>
    );
};

export default ComputerHeader;
