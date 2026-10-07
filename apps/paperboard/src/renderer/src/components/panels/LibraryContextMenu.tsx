import type { Component } from "solid-js";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
} from "@mileniumhq/paperui";

interface LibraryContextMenuProps {
    menu: ReturnType<typeof useContextMenuState>;
    onClose: () => void;
    onReload: () => void;
}

// Right-click menu shown for the Panel Library entry in the sidebar. Unlike a
// panel, the library has no service to restart: Reload fetches a fresh copy of
// the embedded library site.
const LibraryContextMenu: Component<LibraryContextMenuProps> = (props) => {
    return (
        <PaperContextMenu
            open={props.menu.isOpen()}
            target={props.menu.target()}
            placement={props.menu.placement()}
            onClose={() => props.onClose()}
        >
            <PaperContextMenuItem icon="refresh" onClick={() => props.onReload()}>
                Reload Library
            </PaperContextMenuItem>
        </PaperContextMenu>
    );
};

export default LibraryContextMenu;
