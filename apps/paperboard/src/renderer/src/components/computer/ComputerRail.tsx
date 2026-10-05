import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import {
    PaperRail,
    PaperRailItem,
    PaperRailAction,
    PaperSeparator,
    PaperIcon,
} from "@mileniumhq/paperui";
import styles from "./ComputerRail.module.css";

import type { AppUpdateState } from "../../../../shared/appUpdate";

interface ComputerRailProps {
    updateState?: AppUpdateState;
    showUpdate?: boolean;
    onOpenUpdate?: () => void;
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
    // R9: the initial computers-list failed — the rail shows only "local"
    // and the user needs a way to retry instead of a silently broken rail
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}

// Left rail: computers, add-computer action, settings entry ("__settings")
const ComputerRail = (props: ComputerRailProps): JSX.Element => {
    return (
        <PaperRail
            class={styles.rail}
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
            <Show when={props.loadFailed}>
                <PaperRailAction
                    icon="refresh"
                    label="Couldn't load computers. Retry"
                    onClick={() => props.onRetryLoad?.()}
                />
            </Show>
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
            <Show when={props.showUpdate && ["downloading", "ready", "failed", "manual"].includes(props.updateState?.status ?? "")}>
                <PaperRailAction
                    icon="browser_updated"
                    class={`${styles.updateAction} ${props.updateState?.status === "failed" ? styles.updateFailed : styles.updateAvailable}`}
                    label={props.updateState?.status === "failed" ? "Paperboard update failed" : "Paperboard update available"}
                    onClick={() => props.onOpenUpdate?.()}
                />
            </Show>
        </PaperRail>
    );
};

export default ComputerRail;
