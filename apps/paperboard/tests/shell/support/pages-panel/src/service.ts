import { config, definePanelService } from "@mileniumhq/paperapi";

const ID = "dev.paperboard.testpages";
// every count of open pages the service heard, kept where the test reads it
const heard: number[] = [];

definePanelService({
    id: ID,
    state: {},
    actions: {},
    onPagesChanged: async (_ctx, open) => {
        heard.push(open);
        await config.set({ heard: [...heard] }, ID);
    },
});
