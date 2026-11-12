import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { LIMITS, type PromptEntry } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";
import type { SignInDraft } from "./SignIn";

/** The servers a request's secret fields are saved for, as one phrase: "Linear and GitHub". */
function serversText(entry: PromptEntry): string {
    const servers = [...new Set(entry.fields.flatMap((f) => (f.secret ? [f.secret.server] : [])))];
    return servers.length < 2 ? (servers[0] ?? "") : `${servers.slice(0, -1).join(", ")} and ${servers.at(-1)}`;
}

/**
 * The agent asking the user for things only they know. Plain answers go to the agent; a secret one goes
 * to the vault for a tool server, and the agent never sees it. The draft outlives the chat's row redraws
 * and is dropped as soon as the request is answered.
 */
export default function Prompt(props: { agent: Agent; entry: PromptEntry; name: string; draft: SignInDraft; onDone: () => void }) {
    const e = () => props.entry;
    const [values, setValues] = createSignal<string[]>(props.draft.values.length ? props.draft.values : e().fields.map(() => ""));
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const secrets = () => e().fields.some((f) => f.secret);

    const setValue = (i: number, v: string) => {
        const next = values().slice();
        next[i] = v;
        setValues(next);
        props.draft.values = next;
    };

    const answer = (run: () => Promise<unknown>) => {
        setError(null);
        setBusy(true);
        run().then(
            () => undefined,
            (err) => setError(errorText(err)),
        ).finally(() => setBusy(false));
    };
    // however it ended (sent, declined, lapsed, failed), what was typed goes with it
    createEffect(() => {
        if (e().status === "waiting") return;
        setValues(e().fields.map(() => ""));
        props.onDone();
    });

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={e().title} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>edit_note</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">{e().title}</PaperText>
                        <PaperText preset="hint" breakWord>
                            {e().reason}
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <Switch>
                    <Match when={e().status === "waiting"}>
                        <form
                            onSubmit={(ev) => {
                                ev.preventDefault();
                                answer(() => props.agent.answerPrompt(e().id, values()));
                            }}
                        >
                            <PaperFlex gap="half">
                                <For each={e().fields}>
                                    {(f, i) => (
                                        <PaperInput
                                            name={`prompt-${i()}`}
                                            label={f.label}
                                            icon={f.secret ? "key" : undefined}
                                            type={f.secret ? "password" : "text"}
                                            autocomplete="off"
                                            fullWidth
                                            maxLength={LIMITS.prompt.valueChars}
                                            value={values()[i()] ?? ""}
                                            onInput={(ev) => setValue(i(), ev.currentTarget.value)}
                                            disabled={busy()}
                                        />
                                    )}
                                </For>
                                <Show when={secrets()}>
                                    <PaperText preset="hint">
                                        Keys go straight to your vault for {serversText(e())}. {props.name} never sees them.
                                    </PaperText>
                                </Show>
                                <PaperFlex direction="row" justify="flex-end" gap="half">
                                    <PaperButton variant="text" type="button" disabled={busy()} onClick={() => answer(() => props.agent.declinePrompt(e().id))}>
                                        Not now
                                    </PaperButton>
                                    <PaperButton type="submit" disabled={busy() || values().some((v) => !v.trim())}>
                                        Send
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </form>
                    </Match>
                    <Match when={e().status === "sending"}>
                        <PaperLoader loaderStatus="indeterminate" label="Sending" />
                    </Match>
                    <Match when={e().status === "sent"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">{secrets() ? `Sent. Keys are saved for ${serversText(e())}.` : "Sent."}</PaperText>
                        </PaperFlex>
                    </Match>
                    <Match when={e().status === "declined"}>
                        <PaperText preset="hint">You said no.</PaperText>
                    </Match>
                    <Match when={e().status === "expired"}>
                        <PaperText preset="hint">This request lapsed. {props.name} can ask again.</PaperText>
                    </Match>
                    <Match when={e().status === "failed"}>
                        <PaperQuote variant="danger" icon="error" title="Not sent" role="alert">
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
