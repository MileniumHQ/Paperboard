import type { Accessor } from "solid-js";
import type { PanelItem, WidgetOptionValues, WidgetSize } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import type { HomeItem } from "../../lib/homeLayout";
import type { LoadQueue } from "../../lib/loadQueue";
import type { LibraryEntry } from "./WidgetLibrary";
import PanelWidgetFrame, { type FrameFacts } from "./PanelWidgetFrame";
import { BuiltinView, builtinWidget } from "./builtins";
import { tileStatus } from "./tileStatus";

/** What a widget is drawn from: a placed item, or a gallery entry being dragged. */
export type WidgetRef = Pick<LibraryEntry, "computerId" | "source"> & { widgetId: string; panelId?: string; options?: WidgetOptionValues };

export interface HomeWidgetsOptions {
    computers: () => ComputerInfo[];
    panelsByComputer: () => Record<string, PanelItem[]>;
    panelsLoadFailed: () => Record<string, boolean>;
    refreshPanels: (computerId: string) => void;
    openPanel: (computerId: string, panelId: string) => void;
    openComputer: (computerId: string) => void;
    /** bumped when a panel is restarted, by `computerId::panelId` */
    reloadTokens: () => Record<string, number>;
    queue: LoadQueue;
    /** a widget being arranged doesn't navigate when pressed */
    navigates: Accessor<boolean>;
}

// What each widget on Home, in the gallery or carried shows, and what it is called.
export function createHomeWidgets(options: HomeWidgetsOptions) {
    const panelOf = (computerId: string, panelId: string) => options.panelsByComputer()[computerId]?.find((p) => p.id === panelId);
    const statusOf = (item: HomeItem) =>
        tileStatus(item, {
            computers: options.computers(),
            panelsByComputer: options.panelsByComputer(),
            panelsLoadFailed: options.panelsLoadFailed(),
            refreshPanels: options.refreshPanels,
        });
    const computerName = (id: string) => options.computers().find((c) => c.id === id)?.name ?? id;
    const panelName = (computerId: string, panelId: string) => panelOf(computerId, panelId)?.name ?? panelId;
    // what a panel's widget frames load against: whether it runs a service,
    // and a revision that changes when it is updated or restarted
    const frameFacts = (computerId: string, panelId: string): FrameFacts => {
        const panel = panelOf(computerId, panelId);
        return {
            service: !!panel?.service,
            computerName: computerName(computerId),
            revision: `${panel?.version ?? ""}|${panel?.updatedAt ?? ""}|${options.reloadTokens()[`${computerId}::${panelId}`] ?? 0}`,
        };
    };
    const declarationOf = (item: HomeItem) =>
        item.source === "builtin"
            ? builtinWidget(item.widgetId)?.declaration
            : panelOf(item.computerId, item.panelId)?.widgets?.find((w) => w.id === item.widgetId);
    const labelOf = (item: HomeItem) => {
        const name = declarationOf(item)?.name ?? item.widgetId;
        if (item.source === "panel") return `${name} (${panelName(item.computerId, item.panelId)})`;
        // a CPU or Memory widget says which computer it shows once there's a choice
        return builtinWidget(item.widgetId)?.perComputer && options.computers().length > 1 ? `${name} (${computerName(item.computerId)})` : name;
    };

    // a built-in widget draws in place; a panel widget is the panel's frame
    const content = (from: WidgetRef, size: () => WidgetSize, visible: () => boolean, instanceId: string, label: () => string) => {
        const builtin = from.source === "builtin" ? builtinWidget(from.widgetId) : undefined;
        if (builtin) {
            return (
                <BuiltinView
                    widget={builtin}
                    computerId={from.computerId}
                    computerName={computerName(from.computerId)}
                    showComputer={options.computers().length > 1}
                    size={size()}
                    options={from.options ?? {}}
                    visible={visible()}
                    panelName={(panelId) => panelName(from.computerId, panelId)}
                    computers={options.computers()}
                    panels={options.panelsByComputer()[from.computerId]}
                    panelsFailed={!!options.panelsLoadFailed()[from.computerId]}
                    onRetryPanels={() => options.refreshPanels(from.computerId)}
                    onOpenPanel={options.navigates() ? (panelId) => options.openPanel(from.computerId, panelId) : undefined}
                    onOpenComputer={options.navigates() ? options.openComputer : undefined}
                />
            );
        }
        if (!from.panelId) return null;
        const panelId = from.panelId;
        return (
            <PanelWidgetFrame
                computerId={from.computerId}
                computerName={frameFacts(from.computerId, panelId).computerName}
                panelId={panelId}
                widgetId={from.widgetId}
                instanceId={instanceId}
                size={size()}
                options={from.options}
                service={frameFacts(from.computerId, panelId).service}
                revision={frameFacts(from.computerId, panelId).revision}
                visible={visible()}
                label={label()}
                queue={options.queue}
                onOpenPanel={() => options.openPanel(from.computerId, panelId)}
            />
        );
    };

    return { statusOf, panelName, frameFacts, labelOf, content };
}
