// The agent's computer as the UI shows it: the setup's progress, straight
// from the service's state.

import { Index, Show } from "solid-js";
import { PaperFlex, PaperLoader, PaperLoaderGroup, PaperQuote, type LoaderStatus } from "@mileniumhq/paperui";
import { type ComputerState, type SetupStepId, type StepStatus } from "../contract";

const LABELS: Record<SetupStepId, string> = {
    download: "Downloading Helium...",
    unpack: "Installing Helium...",
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
        <PaperFlex gap="full">
            <PaperLoaderGroup>
                {/* each update is a new list of new rows, so the loaders are kept by position: recreating them would
                    replay every finished one's success animation and skip the running one's transition */}
                <Index each={rows(props.computer)}>
                    {(row) => <PaperLoader percent={row().percent ?? 0} loaderStatus={loaderStatus(row())} label={row().label} />}
                </Index>
            </PaperLoaderGroup>
            <Show when={props.computer.phase === "failed" || props.computer.phase === "unsupported"}>
                <PaperQuote
                    variant="danger"
                    icon="error"
                    title={props.computer.phase === "unsupported" ? "No computer on this machine" : "Setup stopped"}
                    role="alert"
                >
                    {props.computer.error}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}
