import { definePanelService } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./contract";
import { initialState, type AiState } from "./core/types";
import { AiApp } from "./service/app";
import { publicActions, uiActions } from "./service/actions";

const app = new AiApp();

export const aiService = definePanelService<AiState, ReturnType<typeof publicActions>>({
    id: PANEL_ID,
    state: initialState(),
    categories: [{ name: "AI", icon: "smart_toy", order: 1 }],
    actions: [...publicActions(app), ...uiActions(app)],
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
