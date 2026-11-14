import type { PanelItem } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import type { HomeItem } from "../../lib/homeLayout";
import type { TileStatus } from "./WidgetTile";
import { sizeLabel } from "./WidgetLibrary";
import { builtinWidget } from "./builtins";

export interface TileFacts {
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    /** lists a computer's panels again */
    refreshPanels: (computerId: string) => void;
}

/** what a placed widget can show: itself, or why it isn't there (with a retry when one can help) */
export function tileStatus(item: HomeItem, facts: TileFacts): TileStatus {
    const comp = facts.computers.find((c) => c.id === item.computerId);
    if (!comp) return { kind: "unavailable", message: "This widget's computer was removed from Paperboard." };
    if (item.source === "builtin") {
        const builtin = builtinWidget(item.widgetId);
        if (!builtin) return { kind: "unavailable", message: "This version of Paperboard doesn't have this widget." };
        if (!builtin.declaration.sizes.includes(item.size)) {
            return { kind: "unavailable", message: `${builtin.declaration.name} doesn't come in ${sizeLabel(item.size)}.` };
        }
        const offered = (builtin.declaration.options ?? []).every((option) =>
            builtin.choices?.[option.id]?.some((choice) => choice.value === item.options?.[option.id]),
        );
        if (!offered) return { kind: "unavailable", message: `This version of Paperboard doesn't have this ${builtin.declaration.name.toLowerCase()}.` };
        if (builtin.perComputer && !comp.isLocal && comp.status?.connected === false) {
            return { kind: "unavailable", message: `${comp.name} is offline.` };
        }
        return { kind: "ok" };
    }
    const retry = () => facts.refreshPanels(item.computerId);
    if (!comp.isLocal && comp.status?.connected === false) {
        return { kind: "unavailable", message: `${comp.name} is offline.`, retry };
    }
    const panels = facts.panelsByComputer[item.computerId];
    if (!panels) {
        if (facts.panelsLoadFailed[item.computerId]) {
            return { kind: "unavailable", message: `Couldn't load panels from ${comp.name}.`, retry };
        }
        return { kind: "waiting", message: "Loading widget…" };
    }
    const panel = panels.find((p) => p.id === item.panelId);
    if (!panel) return { kind: "unavailable", message: `${item.panelId} isn't installed on ${comp.name}.`, retry };
    const widget = panel.widgets?.find((w) => w.id === item.widgetId);
    if (!widget) return { kind: "unavailable", message: `${panel.name} no longer offers this widget.`, retry };
    if (!widget.sizes.includes(item.size)) {
        return { kind: "unavailable", message: `${panel.name} no longer offers this widget at ${sizeLabel(item.size)}.` };
    }
    return { kind: "ok" };
}
