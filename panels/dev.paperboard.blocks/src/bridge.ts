// The page's one line to its service: every window mirrors the service's
// state through it and calls the service's actions on it.
import { createPanelBridge } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "./panel";

export const bridge = createPanelBridge<PanelState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });

/** What finished or failed: a title naming the operation, and what happened. */
export interface Notice {
    kind: "done" | "failed";
    title: string;
    text: string;
}
