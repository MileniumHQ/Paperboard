import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { PaperIcon, PaperLoader, PaperMarkdown, PaperText } from "@paperboard-dev/paperui";
import { isThinkingLive } from "../core/chain";
import type { AssistantMessage, BuiltinTool, ToolCallRecord } from "../core/types";
import { state } from "../lib/state";
import { panelIcon, panelName } from "../lib/panels";
import ToolCallApproval, { ACTION_STATUS, ActionDetails } from "./ToolCallCard";
import styles from "./ReasoningChain.module.css";

/** One collapsible row of the chain: icon, label, status, details. */
function ChainStep(props: {
    icon: JSX.Element;
    label: JSX.Element;
    status?: JSX.Element;
    /** false while there is nothing to show yet (waiting for the model) */
    expandable?: boolean;
    children: JSX.Element;
}) {
    const [open, setOpen] = createSignal(false);
    const expandable = () => props.expandable !== false;
    return (
        <div class={styles.step} classList={{ [styles.open!]: open() && expandable() }}>
            <button
                type="button"
                class={styles.head}
                aria-expanded={expandable() ? open() : undefined}
                // not `disabled`: the library greys disabled controls, and
                // this row carries the live loader while it waits
                aria-disabled={!expandable()}
                tabIndex={expandable() ? 0 : -1}
                onClick={() => expandable() && setOpen(!open())}
            >
                <span class={styles.icon}>{props.icon}</span>
                <span class={styles.label}>{props.label}</span>
                <span class={styles.status}>{props.status}</span>
                <Show when={expandable()}>
                    <PaperIcon class={styles.chevron}>expand_more</PaperIcon>
                </Show>
            </button>
            <Show when={open() && expandable()}>
                <div class={styles.body}>{props.children}</div>
            </Show>
        </div>
    );
}

/** Waiting, then thinking, then the finished thought process: one row. */
export function ThinkingStep(props: { round: AssistantMessage }) {
    const live = () => isThinkingLive(props.round);
    const label = () => (!props.round.thinking ? "Waiting for the model" : live() ? "Thinking" : "Thought process");
    return (
        <ChainStep
            icon={
                <Show when={live()} fallback={<PaperIcon>lightbulb</PaperIcon>}>
                    <PaperLoader loaderStatus="indeterminate" size="small" />
                </Show>
            }
            label={label()}
            expandable={Boolean(props.round.thinking)}
        >
            <PaperMarkdown text={props.round.thinking ?? ""} class={styles.thinkingText} />
        </ChainStep>
    );
}

function ActionStatus(props: { call: ToolCallRecord }) {
    return (
        <Switch>
            <Match when={props.call.status === "running"}>
                <PaperLoader loaderStatus="indeterminate" size="small" aria-label="Running" />
            </Match>
            <Match when={props.call.status === "done"}>
                <PaperIcon class={styles.done} aria-label="Done">check</PaperIcon>
            </Match>
            <Match when={true}>
                <PaperText size={1} color={props.call.status === "error" ? "danger" : "text-muted"}>
                    {ACTION_STATUS[props.call.status].text}
                </PaperText>
            </Match>
        </Switch>
    );
}

/** A decided action is a chain row; one still waiting is the approval card. */
const BUILTIN_ICONS: Record<BuiltinTool, string> = { web_search: "travel_explore", run_shell_command: "terminal" };

/** What a built-in step shows after its label: the query or the command. */
function builtinSubject(call: ToolCallRecord): string {
    const value = call.builtin === "web_search" ? call.arguments.query : call.arguments.command;
    return typeof value === "string" ? value : "";
}

export function ActionStep(props: { call: ToolCallRecord }) {
    const waiting = () => state.approvals.some((a) => a.id === props.call.id);
    const known = () => Boolean(props.call.panelId);
    return (
        <Show when={!waiting()} fallback={<ToolCallApproval call={props.call} />}>
            <ChainStep
                icon={
                    <Switch fallback={<PaperIcon>bolt</PaperIcon>}>
                        <Match when={props.call.builtin}>{(b) => <PaperIcon>{BUILTIN_ICONS[b()]}</PaperIcon>}</Match>
                        <Match when={known()}>
                            <img class={styles.appIcon} src={panelIcon(props.call.panelId)} alt="" />
                        </Match>
                    </Switch>
                }
                label={
                    <Show
                        when={props.call.builtin}
                        fallback={
                            <>
                                <Show when={known()}>
                                    <span class={styles.app}>{panelName(props.call.panelId)}</span>
                                </Show>
                                {props.call.label}
                            </>
                        }
                    >
                        <span class={styles.app}>{props.call.label}</span>
                        <span class={styles.subject}>{builtinSubject(props.call)}</span>
                    </Show>
                }
                status={<ActionStatus call={props.call} />}
            >
                <ActionDetails call={props.call} />
            </ChainStep>
        </Show>
    );
}

/** Actions a round invoked, in the order the model asked for them. */
export function ActionSteps(props: { round: AssistantMessage }) {
    return <For each={props.round.toolCalls ?? []}>{(call) => <ActionStep call={call} />}</For>;
}
