// A panel service whose action backs up its own panel: the backup stops this
// very service while the action is waiting for it (backupFromService.test.ts).
import { backupApi, defineAction, definePanelService } from "../../../../packages/paperapi/src";

export const PANEL_ID = "dev.test.selfbackup";

export default definePanelService({
    id: PANEL_ID,
    state: {},
    actions: [
        defineAction({
            id: "backup-self",
            name: "Back up",
            category: "Test",
            description: "Backs up this panel",
            inputs: {},
            output: { type: "object", label: "Backup" },
            run: async () => backupApi.create(PANEL_ID, { label: "from the action" }),
        }),
    ],
});
