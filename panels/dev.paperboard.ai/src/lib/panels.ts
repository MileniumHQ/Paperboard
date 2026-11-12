// Names and icons of installed panels, for tool cards and permissions.
import { createSignal } from "solid-js";
import { blocksApi, panelAssetUrl, panelsApi, type PanelItem } from "@mileniumhq/paperapi";

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
                const list = await blocksApi.list();
                setLabels(Object.fromEntries(list.map((b) => [`${b.panelId}:${b.entry}`, "name" in b.schema ? b.schema.name : b.entry])));
            } catch (err) {
                console.debug("[ai] block list unavailable:", String(err));
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

export function actionLabel(panelId: string, entry: string): string {
    return labels()[`${panelId}:${entry}`] ?? entry;
}
