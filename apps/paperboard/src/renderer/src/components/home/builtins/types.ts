import type { Component } from "solid-js";
import type { WidgetDeclaration, WidgetSize } from "@mileniumhq/paperapi";

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
}

/** A widget Paperboard draws itself, in the shell, with no frame. */
export interface BuiltinWidget {
    declaration: WidgetDeclaration;
    /** shows one computer (chosen when added), rather than this one */
    perComputer: boolean;
    component: Component<BuiltinWidgetProps>;
}
