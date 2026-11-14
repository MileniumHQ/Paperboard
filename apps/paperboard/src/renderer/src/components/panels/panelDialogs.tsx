import { createSignal } from "solid-js";
import { useContextMenuState } from "@mileniumhq/paperui";
import type { PanelItem } from "@mileniumhq/paperapi";
import LibraryContextMenu from "./LibraryContextMenu";
import PanelContextMenu from "./PanelContextMenu";
import UninstallPanelModal, { type UninstallTarget } from "./UninstallPanelModal";

export interface PanelDialogsOptions {
    restartPanel: (compId: string, panelId: string, name: string) => Promise<void>;
    /** the panel's page, if it holds unsaved work, has its say; false when it chose to stay */
    mayClosePanel: (key: string) => Promise<boolean>;
    /** the panel is gone: the shell lets go of it before the dialog closes */
    onUninstalled: (target: UninstallTarget) => Promise<void>;
}

// A panel's right-click menu in the sidebar and the Uninstall Panel dialog
// it opens, and the Panel Library's menu with the reload it asks for.
// `Dialogs` renders them; the rest opens them.
export function createPanelDialogs(options: PanelDialogsOptions) {
    const panelMenu = useContextMenuState();
    const [menuPanel, setMenuPanel] = createSignal<UninstallTarget | null>(null);
    const [uninstallTarget, setUninstallTarget] = createSignal<UninstallTarget | null>(null);
    const libraryMenu = useContextMenuState();
    // bumping it loads a fresh copy of the library site
    const [libraryReloadToken, setLibraryReloadToken] = createSignal(0);
    const reloadLibrary = () => setLibraryReloadToken((token) => token + 1);

    const openPanelMenu = (compId: string, panel: PanelItem, e: MouseEvent) => {
        setMenuPanel({ compId, panel });
        panelMenu.openAtMouse(e);
    };

    const restart = () => {
        const target = menuPanel();
        if (!target) return;
        panelMenu.close();
        void options.restartPanel(target.compId, target.panel.id, target.panel.name);
    };

    const requestUninstall = async () => {
        const target = menuPanel();
        if (!target) return;
        panelMenu.close();
        if (await options.mayClosePanel(`${target.compId}::${target.panel.id}`)) setUninstallTarget(target);
    };

    const Dialogs = () => (
        <>
            <PanelContextMenu
                menu={panelMenu}
                onClose={() => {
                    panelMenu.close();
                    setMenuPanel(null);
                }}
                onRestart={restart}
                onUninstall={requestUninstall}
            />
            <LibraryContextMenu
                menu={libraryMenu}
                onClose={() => libraryMenu.close()}
                onReload={() => {
                    libraryMenu.close();
                    reloadLibrary();
                }}
            />
            <UninstallPanelModal target={uninstallTarget()} onClose={() => setUninstallTarget(null)} onUninstalled={options.onUninstalled} />
        </>
    );

    return { openPanelMenu, openLibraryMenu: (e: MouseEvent) => libraryMenu.openAtMouse(e), libraryReloadToken, reloadLibrary, Dialogs };
}
