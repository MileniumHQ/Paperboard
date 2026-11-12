import { type Component, Show } from "solid-js";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
} from "@mileniumhq/paperui";

interface ComputerContextMenuProps {
    menu: ReturnType<typeof useContextMenuState>;
    /** this computer can't be forgotten (it's the one Paperboard runs on) */
    isLocal: boolean;
    onInfo: () => void;
    onRename: () => void;
    onForget: () => void;
}

// Right-click menu for a computer on the rail.
const ComputerContextMenu: Component<ComputerContextMenuProps> = (props) => {
    return (
        <PaperContextMenu
            open={props.menu.isOpen()}
            target={props.menu.target()}
            placement={props.menu.placement()}
            onClose={() => props.menu.close()}
        >
            <PaperContextMenuItem icon="info" onClick={() => props.onInfo()}>
                Computer Info
            </PaperContextMenuItem>
            <PaperContextMenuItem icon="edit" onClick={() => props.onRename()}>
                Change Name
            </PaperContextMenuItem>
            <Show when={!props.isLocal}>
                <PaperContextMenuItem icon="delete" danger onClick={() => props.onForget()}>
                    Forget Computer
                </PaperContextMenuItem>
            </Show>
        </PaperContextMenu>
    );
};

export default ComputerContextMenu;
