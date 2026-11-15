// What the page, the service and the widget all need to agree on. It runs in
// the browser and in Node, so it imports nothing from either.
// @if service
import { defineContract, shape } from "@mileniumhq/paperapi";
// @endif

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "__PANEL_ID__";
// @if service

/**
 * What the page and the widget ask the service, and the state the service
 * announces, which every window and the Home widget mirror. The service
 * refuses an input that isn't this shape before its handler runs.
 */
export const panelContract = defineContract(PANEL_ID, {
    calls: {
        greet: { input: shape.object({ name: shape.text() }), output: shape.text() },
    },
    state: { shape: shape.object({ greetingCount: shape.number() }), initial: { greetingCount: 0 } },
});
// @endif
