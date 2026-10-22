import { createContext, useContext } from "solid-js";

/** what a menu entry shows in the phone layout's page bar */
export interface PaperPanelEntry {
    title: () => string;
    /** a Material icon name; element icons can't be shown twice */
    icon?: string;
}

/**
 * Set by PaperPanel. PaperMenu and PaperInterfaceGroup adapt to it, so a
 * panel author composes the two components inside a PaperPanel and writes no
 * layout styles at all.
 *
 * Narrower than a phone's width (compact), the menu fills the panel and the
 * picked entry's interface slides in over it as a page with a back bar.
 */
export interface PaperPanelContextValue {
    inPanel: boolean;
    /** the phone layout: menu as the whole panel, interface as a page */
    compact?: () => boolean;
    /** compact only: whether the interface page is showing */
    pageOpen?: () => boolean;
    openPage?: () => void;
    closePage?: () => void;
    /** menu entries announce their title and icon for the page bar */
    registerEntry?: (value: string | number, entry: PaperPanelEntry) => () => void;
    entry?: (value: string | number) => PaperPanelEntry | undefined;
}

export const PaperPanelContext = createContext<PaperPanelContextValue>();

export function usePaperPanel() {
    return useContext(PaperPanelContext);
}
