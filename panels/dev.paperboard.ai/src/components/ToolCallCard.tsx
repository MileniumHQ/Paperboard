import { createSignal, For, Match, Show, Switch } from "solid-js";
import { PaperBadge, PaperButton, PaperCode, PaperCopyButton, PaperIcon, PaperText, type PaperBadgeVariant } from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { editLines } from "../core/diff";
import type { AgentPermissionKind, AgentToolDetails, AgentToolKind, ToolCallRecord } from "../core/types";
import { call, errorText, state } from "../lib/state";
import { panelIcon, panelName } from "../lib/panels";
import styles from "./ToolCallCard.module.css";

export const ACTION_STATUS: Record<ToolCallRecord["status"], { text: string; variant: PaperBadgeVariant; icon: string }> = {
    "awaiting-approval": { text: "Needs your approval", variant: "warning", icon: "front_hand" },
    running: { text: "Running", variant: "primary", icon: "progress_activity" },
    done: { text: "Done", variant: "success", icon: "check" },
    denied: { text: "Denied", variant: "monochrome", icon: "block" },
    error: { text: "Failed", variant: "danger", icon: "error" },
};

function formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
}

/** Coding agent tools by kind; search and fetch keep the web search look. */
export const AGENT_TOOL_ICONS: Record<AgentToolKind, string> = {
    read: "description",
    edit: "edit_document",
    delete: "delete",
    move: "drive_file_move",
    search: "travel_explore",
    execute: "terminal",
    think: "lightbulb",
    fetch: "travel_explore",
    switch_mode: "swap_horiz",
    other: "build",
};

/** What an agent's tool does: the command, the files, the edits, what it printed. */
export function AgentToolView(props: { details: AgentToolDetails }) {
    return (
        <div class={styles.agentTool}>
            <Show when={props.details.command}>
                <PaperCode block class={styles.request}>{props.details.command}</PaperCode>
            </Show>
            <Show when={props.details.locations.length > 0 && props.details.diffs.length === 0}>
                <ul class={styles.locations}>
                    <For each={props.details.locations}>{(l) => <li>{l}</li>}</For>
                </ul>
            </Show>
            <For each={props.details.diffs}>
                {(d) => {
                    const view = editLines(d.oldText, d.newText);
                    return (
                        <figure class={styles.diff}>
                            <figcaption>
                                <PaperText size={1} weight={600}>{d.path}</PaperText>
                                <Show when={d.oldText === null}>
                                    <PaperText size={1} color="text-muted">New file</PaperText>
                                </Show>
                            </figcaption>
                            <pre class={styles.diffLines}>
                                <For each={view.lines}>
                                    {(line) => (
                                        <span class={styles[line.kind]}>
                                            {line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "}
                                            {line.text}
                                            {"\n"}
                                        </span>
                                    )}
                                </For>
                            </pre>
                            <Show when={view.hidden > 0 || d.truncated}>
                                <PaperText size={1} color="text-muted">
                                    {view.hidden > 0 ? `${view.hidden} more changed lines not shown.` : "The file was cut to fit the chat."}
                                </PaperText>
                            </Show>
                        </figure>
                    );
                }}
            </For>
            <Show when={props.details.output}>
                <PaperCode block class={styles.result}>{props.details.output}</PaperCode>
            </Show>
        </div>
    );
}

/** The expanded content of a decided action in the reasoning chain. */
export function ActionDetails(props: { call: ToolCallRecord }) {
    const args = () => Object.entries(props.call.arguments);
    return (
        <>
            <Show when={props.call.agent}>{(details) => <AgentToolView details={details()} />}</Show>
            <Show when={args().length > 0}>
                <dl class={styles.args}>
                    <For each={args()}>
                        {([key, value]) => (
                            <>
                                <dt>{key}</dt>
                                <dd>{formatValue(value)}</dd>
                            </>
                        )}
                    </For>
                </dl>
            </Show>
            <Show when={props.call.result !== undefined}>
                <PaperCode block class={styles.result}>{props.call.result}</PaperCode>
            </Show>
        </>
    );
}

/**
 * The approval card: shown while the action waits for an answer. The exact
 * app, action and inputs, and the three decisions. Once decided the action
 * becomes a compact chain row (ActionStep in ReasoningChain) instead of this card.
 */
export default function ToolCallApproval(props: { call: ToolCallRecord }) {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const record = () => props.call;
    const waiting = () => state.approvals.some((a) => a.id === record().id);
    const args = () => Object.entries(record().arguments);
    const known = () => Boolean(record().panelId);
    const status = () => ACTION_STATUS[record().status];
    const shell = () => record().builtin === "run_shell_command";
    const agent = () => record().agent;
    const options = () => state.approvals.find((a) => a.id === record().id)?.options ?? [];
    const optionVariant = (kind: AgentPermissionKind) => (kind === "allow_once" ? "primary" : kind.startsWith("reject") ? "danger" : undefined);

    const answer = async (decision: "once" | "always" | "deny" | { optionId: string }) => {
        setBusy(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.resolveApproval, { id: record().id, ...(typeof decision === "string" ? { decision } : decision) });
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Show when={waiting()}>
            <section
                class={styles.ToolCallCard}
                classList={{ [styles.waiting!]: true }}
                aria-label={
                    agent() ? record().label : shell() ? "Run a shell command" : `${record().label} in ${known() ? panelName(record().panelId) : "an unknown app"}`
                }
            >
                <Show when={agent()}>
                    {(details) => (
                        <>
                            <div class={styles.approvalHead}>
                                <PaperIcon class={styles.appIcon}>{AGENT_TOOL_ICONS[details().kind]}</PaperIcon>
                                <div class={styles.title}>
                                    <PaperText size={3} weight={700} truncate>{record().label}</PaperText>
                                    <PaperText size={2} color="text-muted" truncate>The agent asks first</PaperText>
                                </div>
                                <PaperBadge variant={status().variant} icon={status().icon}>{status().text}</PaperBadge>
                            </div>
                            <AgentToolView details={details()} />
                            <div class={styles.actions}>
                                <For each={options()}>
                                    {(o) => (
                                        <PaperButton size="small" variant={optionVariant(o.kind)} disabled={busy()} onClick={() => void answer({ optionId: o.id })}>
                                            {o.name}
                                        </PaperButton>
                                    )}
                                </For>
                            </div>
                        </>
                    )}
                </Show>
                <Show when={!agent()}>
                <div class={styles.approvalHead}>
                    <Switch fallback={<PaperIcon class={styles.appIcon}>help</PaperIcon>}>
                        <Match when={shell()}>
                            <PaperIcon class={styles.appIcon}>terminal</PaperIcon>
                        </Match>
                        <Match when={known()}>
                            <img class={styles.appIcon} src={panelIcon(record().panelId)} alt="" />
                        </Match>
                    </Switch>
                    <div class={styles.title}>
                        <PaperText size={3} weight={700} truncate>{shell() ? "Run shell command" : record().label}</PaperText>
                        <PaperText size={2} color="text-muted" truncate>
                            {shell() ? "On this computer" : known() ? panelName(record().panelId) : record().tool}
                        </PaperText>
                    </div>
                    <PaperBadge variant={status().variant} icon={status().icon}>{status().text}</PaperBadge>
                </div>

                <Show when={shell()}>
                    <PaperCode block class={styles.request}>{String(record().arguments.command ?? "")}</PaperCode>
                </Show>
                <Show when={!shell() && args().length > 0}>
                    <div class={styles.requestBox}>
                        <PaperCopyButton
                            class={styles.requestCopy}
                            text={JSON.stringify(record().arguments, null, 2)}
                            title="Copy inputs"
                            aria-label="Copy inputs"
                        />
                        <dl class={styles.args}>
                            <For each={args()}>
                                {([key, value]) => (
                                    <>
                                        <dt>{key}</dt>
                                        <dd>{formatValue(value)}</dd>
                                    </>
                                )}
                            </For>
                        </dl>
                    </div>
                </Show>

                <PaperText size={2} color="text-muted">
                    {shell()
                        ? "The AI wants to run this command. It asks every time, and nothing runs until you choose."
                        : "The AI wants to run this action. Nothing happens until you choose."}
                </PaperText>
                <div class={styles.actions}>
                    <PaperButton variant="primary" size="small" disabled={busy()} onClick={() => answer("once")}>
                        Allow once
                    </PaperButton>
                    <Show when={!record().builtin}>
                        <PaperButton size="small" disabled={busy()} onClick={() => answer("always")}>
                            Always allow
                        </PaperButton>
                    </Show>
                    <PaperButton variant="danger" size="small" disabled={busy()} onClick={() => answer("deny")}>
                        Deny
                    </PaperButton>
                </div>
                </Show>
                <Show when={error()}>
                    <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
                </Show>
            </section>
        </Show>
    );
}
