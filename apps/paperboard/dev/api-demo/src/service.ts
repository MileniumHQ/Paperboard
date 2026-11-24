// The demo's service: it reads the note when it starts and again after a
// restore, so a restored backup shows up as the note the service saw.
import { definePanelService, fileApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

const NOTE = "note.txt";

definePanelService({
    id: PANEL_ID,
    state: { startedAt: Date.now(), noteAtStart: "" },
    onInit: async (ctx) => {
        const note = await fileApi.read(NOTE, PANEL_ID);
        // a fresh demo has an empty note, so there is always one to back up
        if (note === null) await fileApi.write(NOTE, "", PANEL_ID);
        ctx.setState({ noteAtStart: note ?? "" });
    },
    // the note is all the panel keeps, and only its page writes it
    beforeBackup: () => ({ paths: [NOTE] }),
    afterRestore: async (ctx, ended) => {
        if (!ended.ok) return;
        ctx.setState({ noteAtStart: (await fileApi.read(NOTE, PANEL_ID)) ?? "" });
    },
});
