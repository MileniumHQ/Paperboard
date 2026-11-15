import { For, Match, Switch } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { ToolServerEntry } from "../contract";
import type { Agent } from "../lib/agent";
import { createAction } from "../lib/action";
import RequestEnd from "./RequestEnd";

/** The agent asking to run a program on the user's computer as one of its tool servers. Nothing runs until it's allowed. */
export default function ToolServerRequest(props: { agent: Agent; entry: ToolServerEntry; name: string }) {
    const e = () => props.entry;
    const { busy, error, run } = createAction();
    const title = () => (e().change ? `${props.name} wants to change what ${e().server} runs` : `${props.name} wants to run ${e().server} on your computer`);

    const answer = (allow: boolean) => void run("Answer not sent", () => props.agent.answerToolServer(e().id, allow));

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={title()} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>terminal</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">{title()}</PaperText>
                        <PaperText preset="hint" breakWord>
                            {e().reason}
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <PaperFlex gap="onefourth">
                    <PaperText family="code" size={2} breakWord>
                        {e().command.join(" ")}
                    </PaperText>
                    <For each={e().env}>
                        {(v) => (
                            <PaperText family="code" size={2} color="text-subtle" breakWord>
                                {v.value === null ? `${v.name}: a secret from your vault` : `${v.name}=${v.value}`}
                            </PaperText>
                        )}
                    </For>
                </PaperFlex>
                <PaperText preset="hint">It runs with your access to this computer whenever {props.name} needs its tools.</PaperText>

                <Switch>
                    <Match when={e().status === "waiting"}>
                        <PaperFlex direction="row" gap="half" wrap>
                            <PaperButton variant="primary" disabled={busy()} onClick={() => answer(true)}>
                                Allow
                            </PaperButton>
                            <PaperButton variant="danger" disabled={busy()} onClick={() => answer(false)}>
                                Decline
                            </PaperButton>
                        </PaperFlex>
                    </Match>
                    <Match when={e().status === "allowed"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">Allowed. Switch it off or remove it any time on the Tools page.</PaperText>
                        </PaperFlex>
                    </Match>
                </Switch>
                <RequestEnd entry={e()} name={props.name} failed="Not added" error={error()} />
            </PaperCard>
        </PaperFlex>
    );
}
