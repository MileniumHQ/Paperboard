import { actionsApi } from "./actions";
import { resolvePanelId } from "./identity";
import { STATE_GET_ACTION } from "./channels";
import { hydratePanelBridges } from "./panelHydration";
import { waitForContentPainted } from "./paintReady";

// A document load is not readiness. The shell challenges this generation;
// only a successful authenticated service hydration answers ready.
if (typeof window !== "undefined" && window.parent !== window) {
    const receive = async (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== "paperboard:initialize" || typeof event.data.generation !== "string") return;
        const generation = event.data.generation;
        try {
            const panelId = resolvePanelId();
            if (!panelId) throw new Error("Panel identity is missing");
            await actionsApi.call(panelId, STATE_GET_ACTION);
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
