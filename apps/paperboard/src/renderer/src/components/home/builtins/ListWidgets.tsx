import { PaperButton, PaperWidget, PaperWidgetMessage, PaperWidgetRows, type PaperWidgetRow } from "@mileniumhq/paperui";
import { type Component, createMemo, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import { type PanelRunState, panelRunState, widgetTitle } from "./systemFigures";
import { useUsage } from "./usageStore";

const RUN_LABEL: Record<PanelRunState, string> = {
    running: "Running",
    stopped: "Stopped",
    "no-service": "No service",
    unknown: "",
};

// a running service is green; a stopped one is hollow; a panel with no
// service, or a state not known yet, has no dot to show
const RUN_TONE: Record<PanelRunState, PaperWidgetRow["tone"]> = {
    running: "success",
    stopped: "none",
    "no-service": undefined,
    unknown: undefined,
};

// Every panel on one computer, with whether its service is running; pressing
// one opens it.
export const Panels: Component<BuiltinWidgetProps> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const live = createMemo<ReadonlySet<string> | null>(() => {
        const state = usage.state();
        return state.kind === "ready"
            ? new Set(state.report.groups.filter((g) => g.kind === "panel" && g.memoryBytes > 0).map((g) => g.id))
            : null;
    });
    const rows = (): PaperWidgetRow[] =>
        (props.panels ?? []).map((panel) => {
            const state = panelRunState(!!panel.service, live(), panel.id);
            const open = props.onOpenPanel;
            return {
                id: panel.id,
                label: panel.name,
                detail: RUN_LABEL[state] || undefined,
                tone: RUN_TONE[state],
                ariaLabel: `${panel.name}${RUN_LABEL[state] ? `, ${RUN_LABEL[state].toLowerCase()}` : ""}. Open`,
                onClick: open ? () => open(panel.id) : undefined,
            };
        });
    return (
        <PaperWidget title={widgetTitle("Panels", props)} icon="dashboard" detail={props.panels ? String(props.panels.length) : undefined}>
            <Show
                when={props.panels}
                fallback={
                    <Show when={props.panelsFailed}>
                        <PaperWidgetMessage title="Couldn't list panels" description={`${props.computerName} didn't answer.`} tone="danger">
                            <PaperButton size="tiny" onClick={props.onRetryPanels}>Retry</PaperButton>
                        </PaperWidgetMessage>
                    </Show>
                }
            >
                {(panels) => (
                    <Show when={panels().length > 0} fallback={<PaperWidgetMessage title="No panels yet" description={`Install one on ${props.computerName} from the library.`} />}>
                        <PaperWidgetRows rows={rows()} />
                    </Show>
                )}
            </Show>
        </PaperWidget>
    );
};

// Every paired computer, online or not; pressing one opens it.
export const Computers: Component<BuiltinWidgetProps> = (props) => {
    const online = (id: string) => {
        const computer = props.computers.find((c) => c.id === id);
        return !!computer && (computer.isLocal || computer.status?.connected !== false);
    };
    const rows = (): PaperWidgetRow[] =>
        props.computers.map((computer) => {
            const up = online(computer.id);
            const open = props.onOpenComputer;
            return {
                id: computer.id,
                label: computer.name,
                detail: up ? "Online" : "Offline",
                tone: up ? "success" : "none",
                ariaLabel: `${computer.name}, ${up ? "online" : "offline"}. Open`,
                onClick: open ? () => open(computer.id) : undefined,
            };
        });
    return (
        <PaperWidget
            title="Computers"
            icon="computer"
            detail={`${props.computers.filter((c) => online(c.id)).length}/${props.computers.length} online`}
        >
            <PaperWidgetRows rows={rows()} />
        </PaperWidget>
    );
};
