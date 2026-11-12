import { definePanelService } from "@mileniumhq/paperapi";
import { PANEL_ID, WIDGET_IDS } from "./contract";
import { quickAskModelChoices } from "./core/widgets";
import { initialState, type AiState } from "./core/types";
import { AiApp } from "./service/app";
import { uiCalls } from "./service/calls";

const app = new AiApp();

export const aiService = definePanelService<AiState>({
    id: PANEL_ID,
    state: initialState(),
    calls: uiCalls(app),
    // what Quick ask's "Model" dropdown offers in Home's gallery
    widgetChoices: {
        [WIDGET_IDS.quickAsk]: { model: (ctx) => quickAskModelChoices(ctx.state) },
    },
    async onInit(ctx) {
        await app.init(ctx);
    },
});

// replies and downloads stop with the service; the Ollama child is a
// supervised workload and is replaced (stop observed) on the next start
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
        app.shutdown().finally(() => process.exit(0));
    });
}

export default aiService;
