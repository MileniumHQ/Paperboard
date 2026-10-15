import { actionsApi } from "./actions";
import { resolvePanelId } from "./identity";
import { STATE_GET_ACTION } from "./channels";
import { getTransport } from "./ipc";
import { hydratePanelBridges } from "./panelHydration";
import { waitForContentPainted } from "./paintReady";
import { mountRequestedWidget, parseWidgetInitialize } from "./widget";
import { setFrameSession } from "./frameSession";

// A document load is not readiness. The shell challenges this generation;
// only an authenticated connection, and service hydration when the panel
// has a service, answers ready.
if (typeof window !== "undefined" && window.parent !== window) {
    const receive = async (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== "paperboard:initialize" || typeof event.data.generation !== "string") return;
        const generation = event.data.generation;
        setFrameSession({ generation, widget: event.data.widget !== undefined });
        try {
            const panelId = resolvePanelId();
            if (!panelId) throw new Error("Panel identity is missing");
            // A panel without a service still proves an authenticated
            // connection; one with a service proves the service answers.
            // Only the shell says there is none (from the daemon's manifest).
            if (event.data.service === false) await getTransport().ensureConnected();
            else await actionsApi.call(panelId, STATE_GET_ACTION);
            // A widget frame is the same challenge plus one more fact: the
            // widget the shell asked for is mounted before hydration runs.
            if (event.data.widget !== undefined) {
                const widget = parseWidgetInitialize(event.data.widget);
                if (!widget) throw new Error("The shell sent a malformed widget request");
                await mountRequestedWidget(panelId, generation, widget);
            }
            await hydratePanelBridges(panelId);
            // Hydration is not a settled UI: let fonts and images land so
            // the shell reveals a painted panel instead of a shifting one.
            await waitForContentPainted();
            window.parent.postMessage({ type: "paperboard:ready", generation, panelId }, "*");
        } catch (err) {
            console.error("[paperapi] panel initialization failed:", err);
            window.parent.postMessage({ type: "paperboard:failed", generation, message: err instanceof Error ? err.message : String(err) }, "*");
        }
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => window.removeEventListener("message", receive), { once: true });
}
