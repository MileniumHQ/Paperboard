import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";

// A panel's page says it is open on its own connection, which counts until
// it closes; the panel's service hears how many are (onPagesChanged).
export const pagesRpc = rpcModule({
    "pages:open": ({ panelId }, ctx) => {
        ctx.engine.pageOpened(resourcePanelId(ctx.callerPanelId(), panelId)!, ctx.ws);
        return { success: true };
    },
}, "Counting the panel's page failed");
