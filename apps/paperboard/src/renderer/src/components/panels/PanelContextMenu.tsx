import type { Component } from "solid-js";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
} from "@paperboard-dev/paperui";

interface PanelContextMenuProps {
    menu: ReturnType<typeof useContextMenuState>;
    onClose: () => void;
    onRestart: () => void;
    onUninstall: () => void;
}

// Right-click menu shown for installed panels in the sidebar.
const PanelContextMenu: Component<PanelContextMenuProps> = (props) => {
    return (
        <PaperContextMenu
            open={props.menu.isOpen()}
            target={props.menu.target()}
            placement={props.menu.placement()}
            onClose={() => props.onClose()}
        >
            <PaperContextMenuItem icon="refresh" onClick={() => props.onRestart()}>
                Restart Panel
            </PaperContextMenuItem>
            <PaperContextMenuItem
                icon="delete"
                danger
                onClick={() => props.onUninstall()}
            >
                Uninstall Panel
            </PaperContextMenuItem>
        </PaperContextMenu>
    );
};

export default PanelContextMenu;
