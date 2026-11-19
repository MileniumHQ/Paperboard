import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../principal";

// A panel's page says it is open on its own connection, which counts until
// it closes; the panel's service hears how many are (onPagesChanged).
export const pagesRpc = rpcModule({
    "pages:open": ({ panelId }, ctx, action) => {
        ctx.engine.pageOpened(resourcePanelId(ctx.callerPanelId(), panelId, action)!, ctx.ws);
        return { success: true };
    },
}, "Counting the panel's page failed");
