import type { Component } from "solid-js";
import type { PanelItem, WidgetDeclaration, WidgetSize } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../../lib/shell";

export interface BuiltinWidgetProps {
    /** the computer the widget shows */
    computerId: string;
    computerName: string;
    /** more than one computer is paired, so say which one this is */
    showComputer: boolean;
    size: WidgetSize;
    /** on screen: animate and poll; off screen: stay still */
    visible: boolean;
    /** a panel's display name on this widget's computer */
    panelName: (panelId: string) => string;
    /** every paired computer */
    computers: ComputerInfo[];
    /** the panels installed on this widget's computer; undefined until listed */
    panels: PanelItem[] | undefined;
    /** listing this computer's panels failed */
    panelsFailed: boolean;
    onRetryPanels: () => void;
    /** absent in gallery previews and while Home is being edited, which don't navigate */
    onOpenPanel?: (panelId: string) => void;
    onOpenComputer?: (computerId: string) => void;
}

/** A widget Paperboard draws itself, in the shell, with no frame. */
export interface BuiltinWidget {
    declaration: WidgetDeclaration;
    /** shows one computer (chosen when added), rather than this one */
    perComputer: boolean;
    component: Component<BuiltinWidgetProps>;
}
