// The shell suite's panel whose background work fails: as it starts, two
// problems no button waits for; `fix` is the forecast coming back.
import { definePanelService, problemsApi } from "@mileniumhq/paperapi";

const PANEL = "dev.paperboard.testproblems";

definePanelService({
    id: PANEL,
    state: {},
    calls: {
        fix: () => problemsApi.clear(PANEL, "forecast"),
    },
    onInit: () => {
        problemsApi.report(PANEL, { key: "forecast", title: "The forecast couldn't be read", message: "api.weather.example answered 503 Service Unavailable" });
        problemsApi.report(PANEL, {
            key: "readings",
            title: "Yesterday's readings weren't saved to the station's history, so this week's chart is missing a day",
            message: "EACCES: permission denied, open '/var/lib/weather-station/history/readings/2026-11-14.json.8cf067e8f3d1c5a7.tmp'",
        });
    },
});
