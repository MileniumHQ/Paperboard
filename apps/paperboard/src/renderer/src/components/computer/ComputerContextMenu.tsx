import type { Component } from "solid-js";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
} from "@paperboard-dev/paperui";

interface ComputerContextMenuProps {
    menu: ReturnType<typeof useContextMenuState>;
    onForget: () => void;
}

// Right-click menu for non-local computers in the sidebar. Single action:
// forget the computer without opening its info view first.
const ComputerContextMenu: Component<ComputerContextMenuProps> = (props) => {
    return (
        <PaperContextMenu
            open={props.menu.isOpen()}
            target={props.menu.target()}
            placement={props.menu.placement()}
            onClose={() => props.menu.close()}
        >
            <PaperContextMenuItem icon="delete" danger onClick={() => props.onForget()}>
                Forget Computer
            </PaperContextMenuItem>
        </PaperContextMenu>
    );
};

export default ComputerContextMenu;
