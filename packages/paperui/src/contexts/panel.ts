import { createContext, useContext } from "solid-js";

/**
 * Set by PaperPanel. PaperMenu and PaperInterfaceGroup adapt to it, so a
 * panel author composes the two components inside a PaperPanel and writes no
 * layout styles at all.
 */
export interface PaperPanelContextValue {
    inPanel: boolean;
}

export const PaperPanelContext = createContext<PaperPanelContextValue>();

export function usePaperPanel() {
    return useContext(PaperPanelContext);
}
