// The agent's computer as the UI shows it: the setup's progress, straight
// from the service's state.

import { Index, Show } from "solid-js";
import { PaperLoader, PaperLoaderGroup, type LoaderStatus } from "@mileniumhq/paperui";
import { type ComputerState, type SetupStepId, type StepStatus } from "../contract";
import styles from "./Computer.module.css";

const LABELS: Record<SetupStepId, string> = {
    download: "Download the Helium browser",
    unpack: "Unpack it",
    start: "Start it",
};

function loaderStatus(s: { status: StepStatus; percent?: number | null }): LoaderStatus {
    switch (s.status) {
        case "waiting":
            return "waiting";
        case "running":
            return s.percent == null ? "indeterminate" : "loading";
        case "done":
            return "success";
        case "failed":
            return "error";
    }
}

const rows = (c: ComputerState) => c.steps.map((s) => ({ label: LABELS[s.id], status: s.status, percent: s.percent }));

/** The setup's steps as the service reports them, and its error when it stopped. */
export function SetupProgress(props: { computer: ComputerState }) {
    return (
        <div class={styles.progress}>
            <PaperLoaderGroup>
                {/* each update is a new list of new rows, so the loaders are kept by position: recreating them would
                    replay every finished one's success animation and skip the running one's transition */}
                <Index each={rows(props.computer)}>
                    {(row) => <PaperLoader size="small" percent={row().percent ?? 0} loaderStatus={loaderStatus(row())} label={row().label} />}
                </Index>
            </PaperLoaderGroup>
            <Show when={props.computer.phase === "failed" || props.computer.phase === "unsupported"}>
                <p class={styles.error} role="alert">
                    {props.computer.error}
                </p>
            </Show>
        </div>
    );
}

export { styles as computerStyles };
