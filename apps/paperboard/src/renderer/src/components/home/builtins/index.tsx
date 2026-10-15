// Widgets Paperboard ships itself. They draw in the shell, with no frame
// and no panel, so they cost almost nothing to keep on Home.
import { type Component, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import Clock from "./Clock";
import type { BuiltinWidget, BuiltinWidgetProps } from "./types";
import UsageDonut from "./UsageDonut";
import { Disk, Network, Uptime } from "./SystemWidgets";
import { Computers, Panels } from "./ListWidgets";
import styles from "./Builtins.module.css";

export type { BuiltinWidget, BuiltinWidgetProps } from "./types";
export { defaultHomeItems } from "./defaults";

export const BUILTIN_WIDGETS: BuiltinWidget[] = [
    {
        declaration: { id: "clock", name: "Clock", description: "The time and date", sizes: ["2x1", "2x2", "4x1"] },
        perComputer: false,
        component: Clock,
    },
    {
        declaration: {
            id: "cpu",
            name: "CPU",
            description: "How busy a computer is, and which panels are keeping it busy",
            sizes: ["1x1", "2x1", "2x2"],
        },
        perComputer: true,
        component: (props) => <UsageDonut {...props} metric="cpu" />,
    },
    {
        declaration: {
            id: "memory",
            name: "Memory",
            description: "How much memory each panel uses, and how much is free",
            sizes: ["1x1", "2x1", "2x2"],
        },
        perComputer: true,
        component: (props) => <UsageDonut {...props} metric="memory" />,
    },
    {
        declaration: { id: "disk", name: "Disk", description: "How full the drive holding Paperboard's panels is", sizes: ["1x1", "2x1"] },
        perComputer: true,
        component: Disk,
    },
    {
        declaration: { id: "network", name: "Network", description: "What a computer is downloading and uploading right now", sizes: ["2x1", "2x2"] },
        perComputer: true,
        component: Network,
    },
    {
        declaration: { id: "uptime", name: "Uptime", description: "How long a computer has been running", sizes: ["1x1"] },
        perComputer: true,
        component: Uptime,
    },
    {
        declaration: { id: "panels", name: "Panels", description: "Every panel on a computer and whether it's running", sizes: ["2x2", "2x1"] },
        perComputer: true,
        component: Panels,
    },
    {
        declaration: { id: "computers", name: "Computers", description: "Each paired computer, online or not", sizes: ["2x1", "2x2"] },
        perComputer: false,
        component: Computers,
    },
];

/** A built-in widget's content, sized by its tile or gallery preview. */
export const BuiltinView: Component<BuiltinWidgetProps & { widget: BuiltinWidget }> = (props) => {
    const [local, rest] = splitProps(props, ["widget"]);
    return (
        <div class={styles.root}>
            <Dynamic component={local.widget.component} {...rest} />
        </div>
    );
};

export function builtinWidget(id: string): BuiltinWidget | undefined {
    return BUILTIN_WIDGETS.find((widget) => widget.declaration.id === id);
}
