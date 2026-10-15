// One widget frame's view of the AI service: a state mirror that counts as
// ready only once the service answered (hydration), and visibility as a
// signal so timers can follow it.

import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createPanelBridge, type WidgetContext } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../contract";
import { initialState, type AiState } from "../core/types";

export type Hydration = "loading" | "ready" | "failed";

export interface WidgetService {
    state: AiState;
    hydration: Accessor<Hydration>;
    hydrate: () => Promise<void>;
    call: <R>(action: string, inputs?: Record<string, unknown>) => Promise<R>;
}

/** Call inside a component: the bridge is disposed with it. */
export function useWidgetService(): WidgetService {
    const bridge = createPanelBridge<AiState>({ panelId: PANEL_ID, defaultState: initialState() });
    const [state, setState] = createStore<AiState>(initialState());
    const [hydration, setHydration] = createSignal<Hydration>("loading");
    const offState = bridge.onStateChange((_patch, full) => setState(reconcile(full, { merge: true })));
    const hydrate = async () => {
        setHydration("loading");
        try {
            setState(reconcile(await bridge.refreshState(), { merge: true }));
            setHydration("ready");
        } catch (err) {
            console.warn("[ai widget] the AI service did not answer:", errorText(err));
            setHydration("failed");
        }
    };
    void hydrate();
    onCleanup(() => {
        offState();
        bridge.dispose();
    });
    return { state, hydration, hydrate, call: (action, inputs = {}) => bridge.call(action, inputs) };
}

export function useVisible(widget: WidgetContext): Accessor<boolean> {
    const [visible, setVisible] = createSignal(widget.visible());
    onCleanup(widget.onVisibilityChange(setVisible));
    return visible;
}

export function errorText(err: unknown): string {
    return (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, "");
}
