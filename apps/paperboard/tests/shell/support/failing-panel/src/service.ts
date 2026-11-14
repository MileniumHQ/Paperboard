import { definePanelService } from "@mileniumhq/paperapi";

definePanelService({
    id: "dev.paperboard.testfailing",
    state: {},
    actions: {},
    onInit: async () => {
        throw new Error("the config file is unreadable");
    },
});
