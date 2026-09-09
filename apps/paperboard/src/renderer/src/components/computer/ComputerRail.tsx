import type { JSX } from "solid-js";
import { For } from "solid-js";
import {
    PaperRail,
    PaperRailItem,
    PaperRailAction,
    PaperSeparator,
    PaperIcon,
} from "@paperboard-dev/paperui";

interface ComputerRailProps {
    computers: {
        id: string;
        name: string;
        host: string;
        isLocal?: boolean;
    }[];
    value: string;
    onSelect: (val: string) => void;
    onAdd: () => void;
    onComputerContextMenu?: (compId: string, e: MouseEvent) => void;
}

// Left rail: computers, add-computer action, settings entry ("__settings")
const ComputerRail = (props: ComputerRailProps): JSX.Element => {
    return (
        <PaperRail
            name="computer-selection"
            value={props.value}
            onValueChange={(val) => props.onSelect(String(val))}
        >
            <For each={props.computers}>
                {(comp) => (
                    <PaperRailItem
                        value={comp.id}
                        icon={
                            comp.isLocal ? (
                                "computer"
                            ) : (
                                <PaperIcon monogram>
                                    {(comp.name || "C")
                                        .trim()
                                        .slice(0, 2)
                                        .toUpperCase()}
                                </PaperIcon>
                            )
                        }
                        label={`${comp.name} (${comp.host})`}
                        onContextMenu={(e: MouseEvent) => {
                            if (!comp.isLocal) props.onComputerContextMenu?.(comp.id, e);
                        }}
                    />
                )}
            </For>
            <PaperRailAction
                icon="add"
                label="Add Computer"
                onClick={() => props.onAdd()}
            />
            <PaperSeparator
                direction="vertical"
                style={{
                    height: "1px",
                    width: "70%",
                    margin: "4px auto",
                }}
            />
            <PaperRailItem
                value="__settings"
                icon="settings"
                label="Settings"
            />
        </PaperRail>
    );
};

export default ComputerRail;
