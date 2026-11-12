import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperCollapsible, PaperFlex, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { AccessEntry, AccessItem } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";

/** what a folder or command lets the agent do, in the user's words */
export const itemText = (item: AccessItem) =>
    item.kind === "folder"
        ? { icon: "folder", what: item.path, how: "List, read, search, create and edit files in it" }
        : { icon: "terminal", what: item.command.join(" "), how: item.anyArguments ? "Run it, with any arguments after these" : "Run exactly this" };

/** "2 folders and a command" */
function countText(items: AccessItem[]): string {
    const folders = items.filter((i) => i.kind === "folder").length;
    const commands = items.length - folders;
    const part = (n: number, one: string) => (n === 0 ? null : n === 1 ? `a ${one}` : `${n} ${one}s`);
    const text = [part(folders, "folder"), part(commands, "command")].filter(Boolean).join(" and ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The agent asking for folders and commands on the user's own computer: once, for good, or not at all. */
export default function AccessRequest(props: { agent: Agent; entry: AccessEntry; name: string }) {
    const e = () => props.entry;
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);

    const answer = (how: "once" | "always" | "decline") => {
        setError(null);
        setBusy(true);
        props.agent
            .answerAccess(e().id, how)
            .then(
                () => undefined,
                (err) => setError(errorText(err)),
            )
            .finally(() => setBusy(false));
    };

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
                                            <PaperText family="code" size={2} breakWord>
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
                    <Match when={e().status === "declined"}>
                        <PaperText preset="hint">You said no.</PaperText>
                    </Match>
                    <Match when={e().status === "expired"}>
                        <PaperText preset="hint">This request lapsed. {props.name} can ask again.</PaperText>
                    </Match>
                </Switch>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="error" title="Answer not sent" role="alert">
                        {error()}
                    </PaperQuote>
                </Show>
            </PaperCard>
        </PaperFlex>
    );
}
