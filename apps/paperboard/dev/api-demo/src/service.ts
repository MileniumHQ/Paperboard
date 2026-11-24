// The demo's service: it reads the note when it starts and again after a
// restore, so a restored backup shows up as the note the service saw.
import { definePanelService, fileApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

const NOTE = "note.txt";

definePanelService({
    id: PANEL_ID,
    state: { startedAt: Date.now(), noteAtStart: "" },
    onInit: async (ctx) => {
        ctx.setState({ noteAtStart: (await fileApi.read(NOTE, PANEL_ID)) ?? "" });
    },
    // the note is all the panel keeps, and only its page writes it
    beforeBackup: () => ({ paths: [NOTE] }),
    afterRestore: async (ctx, ended) => {
        if (!ended.ok) return;
        ctx.setState({ noteAtStart: (await fileApi.read(NOTE, PANEL_ID)) ?? "" });
    },
});
