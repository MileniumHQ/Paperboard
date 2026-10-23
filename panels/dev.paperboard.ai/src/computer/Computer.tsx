// The agent's computer as the UI shows it: the budget the user grants it and
// the setup's progress, both straight from the service's state.

import { For, Show } from "solid-js";
import { PaperLoader, PaperLoaderGroup, PaperRange, type LoaderStatus } from "@mileniumhq/paperui";
import { LIMITS, type ComputerBudget, type ComputerState, type SetupPartId, type SetupStep, type SetupStepId, type StepStatus } from "../contract";
import styles from "./Computer.module.css";

export const DEFAULT_BUDGET: ComputerBudget = { memoryGb: 4, diskGb: 32 };

const MEMORY_MARKS = [2, 4, 8, 12, 16, 24, 32];
const DISK_MARKS = [8, 16, 32, 64, 96, 128];

export function Budget(props: { name: string; value: ComputerBudget; onChange: (b: ComputerBudget) => void }) {
    return (
        <div class={styles.budget}>
            <PaperRange
                label="Memory"
                value={props.value.memoryGb}
                min={LIMITS.memoryGb.min}
                max={LIMITS.memoryGb.max}
                marks={MEMORY_MARKS.map((v) => ({ value: v, label: `${v}` }))}
                snapToMarks
                formatValue={(v) => `${v} GB`}
                onInput={(memoryGb) => props.onChange({ ...props.value, memoryGb })}
            />
            <PaperRange
                label="Storage"
                value={props.value.diskGb}
                min={LIMITS.diskGb.min}
                max={LIMITS.diskGb.max}
                marks={DISK_MARKS.map((v) => ({ value: v, label: `${v}` }))}
                snapToMarks
                formatValue={(v) => `${v} GB`}
                onInput={(diskGb) => props.onChange({ ...props.value, diskGb })}
            />
            <p class={styles.note}>These are limits, not reservations: {props.name} only takes what it needs, up to these.</p>
        </div>
    );
}

const LABELS: Record<SetupStepId, (c: ComputerState) => string> = {
    image: () => "Download Debian 13",
    browser: () => "Download the Helium browser",
    disk: (c) => `Make a ${c.budget?.diskGb ?? "?"} GB disk that grows as needed`,
    boot: () => "Start the virtual machine",
    install: () => "Install a desktop and a browser",
};

const PART_LABELS: Record<SetupPartId, string> = {
    power: "Turn it on",
    debian: "Start Debian",
    setup: "Read its setup",
    packages: "Install the desktop's packages",
    hands: "Fetch the agent's hands",
    browser: "Install Helium",
    desktop: "Start the desktop",
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

/** The setup's steps as the service reports them, and its error when it stopped. */
export function SetupProgress(props: { computer: ComputerState }) {
    return (
        <div class={styles.progress}>
            <PaperLoaderGroup>
                <For each={props.computer.steps}>
                    {(s) => (
                        <>
                            <PaperLoader percent={s.percent ?? 0} loaderStatus={loaderStatus(s)} label={LABELS[s.id](props.computer)} />
                            {/* a long step shows what it's doing while it runs, or where it stopped */}
                            <Show when={s.parts.length > 0 && (s.status === "running" || s.status === "failed")}>
                                <div class={styles.parts}>
                                    <For each={s.parts}>{(p) => <PaperLoader size="small" percent={0} loaderStatus={loaderStatus(p)} label={PART_LABELS[p.id]} />}</For>
                                </div>
                            </Show>
                        </>
                    )}
                </For>
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
