// Names and icons of installed panels, for tool cards and permissions.
import { createSignal } from "solid-js";
import { actionsApi, panelAssetUrl, panelsApi, type PanelItem } from "@mileniumhq/paperapi";

const [panels, setPanels] = createSignal<PanelItem[]>([]);
const [labels, setLabels] = createSignal<Record<string, string>>({});
let loading: Promise<void> | null = null;

export function loadPanelInfo(): Promise<void> {
    if (!loading) {
        loading = (async () => {
            try {
                setPanels(await panelsApi.list());
            } catch (err) {
                // names decorate cards; the panel id still identifies
                console.debug("[ai] panel list unavailable:", String(err));
            }
            try {
                const list = await actionsApi.list();
                setLabels(Object.fromEntries(list.map((a) => [`${a.panelId}:${a.action}`, a.schema?.name ?? a.action])));
            } catch (err) {
                console.debug("[ai] action list unavailable:", String(err));
            }
        })().finally(() => {
            loading = null;
        });
    }
    return loading;
}

export function panelName(panelId: string): string {
    return (
        panels().find((p) => p.id === panelId)?.name ||
        panelId
            .split(".")
            .pop()!
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
    );
}

export function panelIcon(panelId: string): string {
    const found = panels().find((p) => p.id === panelId);
    return found?.iconUrl || panelAssetUrl(panelId, found?.icon || "branding/icon.png");
}

export function actionLabel(panelId: string, action: string): string {
    return labels()[`${panelId}:${action}`] ?? action;
}
