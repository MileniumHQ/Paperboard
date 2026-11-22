import { For, Match, Switch } from "solid-js";
import { PaperButton, PaperCard, PaperCollapsible, PaperFlex, PaperIcon, PaperText, createAction } from "@mileniumhq/paperui";
import type { AccessEntry, AskedItem } from "../contract";
import type { Agent } from "../lib/agent";
import RequestEnd from "./RequestEnd";

/** what a folder or a shell lets the agent do, in the user's words; a single command is what requests asked for before shells */
export const itemText = (item: AskedItem) => {
    if (item.kind === "folder") return { icon: "folder", what: item.path, code: true, how: "List, read, search, create and edit files in it" };
    if (item.kind === "shell") return { icon: "terminal", what: "A shell", code: false, how: "Run any command as you, in shells it keeps open until the task is done" };
    return { icon: "terminal", what: item.command.join(" "), code: true, how: item.anyArguments ? "Run it, with any arguments after these" : "Run exactly this" };
};

/** "2 folders and a shell" */
function countText(items: AskedItem[]): string {
    const count = (kind: AskedItem["kind"]) => items.filter((i) => i.kind === kind).length;
    const part = (n: number, one: string) => (n === 0 ? null : n === 1 ? `a ${one}` : `${n} ${one}s`);
    const parts = [part(count("folder"), "folder"), part(count("shell"), "shell"), part(count("command"), "command")].filter((p) => p !== null);
    const text = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The agent asking for folders and a shell on the user's own computer: once, for good, or not at all. */
export default function AccessRequest(props: { agent: Agent; entry: AccessEntry; name: string }) {
    const e = () => props.entry;
    const { busy, run } = createAction();

    const answer = (how: "once" | "always" | "decline") => void run("Couldn't send your answer", () => props.agent.calls.answerAccess({ id: e().id, how }));

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`${props.name} requests permission`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>shield_person</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">{props.name} requests permission</PaperText>
                        <PaperText preset="hint" breakWord>
                            {e().reason}
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <PaperCollapsible title={`${countText(e().items)} on your computer`}>
                    <PaperFlex gap="half">
                        <For each={e().items}>
                            {(item) => {
                                const t = itemText(item);
                                return (
                                    <PaperFlex direction="row" align="start" gap="half">
                                        <PaperIcon>{t.icon}</PaperIcon>
                                        <PaperFlex gap="onefourth" minWidth={0}>
                                            <PaperText family={t.code ? "code" : undefined} size={2} breakWord>
                                                {t.what}
                                            </PaperText>
                                            <PaperText preset="hint">{t.how}</PaperText>
                                        </PaperFlex>
                                    </PaperFlex>
                                );
                            }}
                        </For>
                    </PaperFlex>
                </PaperCollapsible>

                <Switch>
                    <Match when={e().status === "waiting"}>
                        <PaperFlex direction="row" gap="half" wrap>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => answer("once")}>
                                Allow this time
                            </PaperButton>
                            <PaperButton variant="success" disabled={busy()} onClick={() => answer("always")}>
                                Always allow
                            </PaperButton>
                            <PaperButton variant="danger" disabled={busy()} onClick={() => answer("decline")}>
                                Decline
                            </PaperButton>
                        </PaperFlex>
                    </Match>
                    <Match when={e().status === "allowed"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">Allowed this time.</PaperText>
                        </PaperFlex>
                    </Match>
                    <Match when={e().status === "always"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">Always allowed. Take it back any time on the Access page.</PaperText>
                        </PaperFlex>
                    </Match>
                </Switch>
                <RequestEnd entry={e()} name={props.name} />
            </PaperCard>
        </PaperFlex>
    );
}
