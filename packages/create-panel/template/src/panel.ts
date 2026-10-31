// What the page, the service and the widget all need to agree on. It runs in
// the browser and in Node, so it imports nothing from either.

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "__PANEL_ID__";
// @if service

/** What the service announces. Every window, and the Home widget, mirrors it. */
export interface PanelState {
    greetingCount: number;
}

export const DEFAULT_STATE: PanelState = { greetingCount: 0 };
// @endif
