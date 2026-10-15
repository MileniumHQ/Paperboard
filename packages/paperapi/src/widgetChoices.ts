// Home's side of widget options: asks the service of one panel, on one
// computer, what an option's dropdown offers. Panel and computer are both
// explicit; nothing here falls back to "the current panel".
import { WIDGET_CHOICES_ACTION } from "./channels";
import { getTransport } from "./ipc";
import { parseWidgetChoices, type WidgetChoice } from "./widgetManifest";

const WIDGET_CHOICES_TIMEOUT_MS = 10_000;

export async function getWidgetChoices(
    computerId: string,
    panelId: string,
    widgetId: string,
    optionId: string,
): Promise<WidgetChoice[]> {
    const transport = getTransport(computerId);
    await transport.ensureConnected();
    const res = await transport.call(
        "actions:call",
        { panelId, action: WIDGET_CHOICES_ACTION, args: [{ widgetId, optionId }, undefined], timeoutMs: WIDGET_CHOICES_TIMEOUT_MS },
        WIDGET_CHOICES_TIMEOUT_MS,
    );
    return parseWidgetChoices(res?.result);
}
