import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { ToolServerEntry } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";

/** The agent asking to run a program on the user's computer as one of its tool servers. Nothing runs until it's allowed. */
export default function ToolServerRequest(props: { agent: Agent; entry: ToolServerEntry; name: string }) {
    const e = () => props.entry;
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const title = () => (e().change ? `${props.name} wants to change what ${e().server} runs` : `${props.name} wants to run ${e().server} on your computer`);

    const answer = (allow: boolean) => {
        setError(null);
        setBusy(true);
        props.agent
            .answerToolServer(e().id, allow)
            .then(
                () => undefined,
                (err) => setError(errorText(err)),
            )
            .finally(() => setBusy(false));
    };

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
                    <Match when={e().status === "declined"}>
                        <PaperText preset="hint">You said no.</PaperText>
                    </Match>
                    <Match when={e().status === "expired"}>
                        <PaperText preset="hint">This request lapsed. {props.name} can ask again.</PaperText>
                    </Match>
                    <Match when={e().status === "failed"}>
                        <PaperQuote variant="danger" icon="error" title="Not added" role="alert">
                            {e().error}. {props.name} was told and can ask again.
                        </PaperQuote>
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
