// The agent's computer as the UI shows it: the setup's progress, straight
// from the service's state.

import { Index, Show } from "solid-js";
import { formatByteProgress, PaperError, PaperFlex, PaperLoader, PaperLoaderGroup, PaperQuote, type LoaderStatus, type PaperErrorAction } from "@mileniumhq/paperui";
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

const rows = (c: ComputerState) =>
    c.steps.map((s) => ({
        label: LABELS[s.id],
        subtitle: s.status === "running" && s.bytes && s.bytes.done > 0 ? formatByteProgress(s.bytes.done, s.bytes.total) : undefined,
        status: s.status,
        percent: s.percent,
    }));

/** The setup's steps as the service reports them. A setup that stopped says why, with `retry`; a machine with no computer says so. */
export function SetupProgress(props: { computer: ComputerState; retry?: PaperErrorAction }) {
    return (
        <PaperFlex gap="full">
            <PaperLoaderGroup>
                {/* each update is a new list of new rows, so the loaders are kept by position: recreating them would
                    replay every finished one's success animation and skip the running one's transition */}
                <Index each={rows(props.computer)}>
                    {(row) => <PaperLoader percent={row().percent ?? 0} loaderStatus={loaderStatus(row())} label={row().label} subtitle={row().subtitle} />}
                </Index>
            </PaperLoaderGroup>
            <Show when={props.computer.phase === "failed"}>
                <PaperError title="Couldn't set up the computer" error={props.computer.error} action={props.retry} />
            </Show>
            <Show when={props.computer.phase === "unsupported"}>
                <PaperQuote variant="warning" icon="desktop_access_disabled" title="No computer on this machine">
                    {props.computer.error}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}
