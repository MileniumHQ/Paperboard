// The demo's service: it reads the note when it starts, so a restored
// backup shows up as the note the restarted service saw.
import { definePanelService, fileApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

definePanelService({
    id: PANEL_ID,
    state: { startedAt: Date.now(), noteAtStart: "" },
    actions: {},
    onInit: async (ctx) => {
        ctx.setState({ noteAtStart: (await fileApi.read("note.txt", PANEL_ID)) ?? "" });
    },
});
