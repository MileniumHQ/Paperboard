// A panel's page tells the computer that serves it that it is open, on the
// page's own connection: the computer counts it until that connection
// closes, and tells the panel's service how many of its pages are open
// (definePanelService's onPagesChanged). A widget is not a page.
import { errorCode, errorMessage } from "./errors";
import { getTransport } from "./ipc";
import { problemsApi } from "./problems";

let announced = false;

/** Counts this document as one of the panel's open pages, now and after each reconnect. */
export function announcePage(panelId: string): void {
    if (announced) return;
    announced = true;
    const transport = getTransport();
    const announce = () =>
        transport.call("pages:open", { panelId }).catch((err: unknown) => {
            // quiet: a Paperboard Server from before pages were counted doesn't know the call, and there is nothing to count with
            if (errorCode(err) === "NOT_FOUND") return;
            problemsApi.report(panelId, { key: "paperapi:pages", title: "The panel's service couldn't be told its page is open", message: errorMessage(err) });
        });
    transport.onStatus((status) => {
        if (status.connected) void announce();
    });
    void announce();
}
