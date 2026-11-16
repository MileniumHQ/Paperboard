import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperError, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperText, createAction, createRead } from "@mileniumhq/paperui";
import { LIMITS, type SignInEntry } from "../contract";
import type { Agent } from "../lib/agent";
import RequestEnd from "./RequestEnd";
import styles from "./SignIn.module.css";

/**
 * What a waiting card keeps while the chat redraws its rows: the values typed so far and the picture.
 * Dropped as soon as the request is answered, so a typed password lives no longer than the card asking for it.
 */
export interface SignInDraft {
    values: string[];
    image: string | null;
}

/** The agent asking to sign in on a site: the user types the values here, and the agent never sees them. */
export default function SignIn(props: { agent: Agent; entry: SignInEntry; name: string; draft: SignInDraft; onDone: () => void }) {
    const e = () => props.entry;
    const [values, setValues] = createSignal<string[]>(props.draft.values.length ? props.draft.values : e().fields.map(() => ""));
    // the draft keeps the picture for the card that replaces this one when the chat redraws
    const kept = props.draft.image;
    const shot = createRead((id: string) => props.agent.calls.signInShot({ id }).then((r) => (props.draft.image = r.image)), {
        source: () => (e().status === "waiting" && !kept ? e().id : undefined),
    });
    const image = () => shot.value() ?? kept;
    const { busy, run } = createAction();

    const setValue = (i: number, v: string) => {
        const next = values().slice();
        next[i] = v;
        setValues(next);
        props.draft.values = next;
    };

    const answer = async (send: () => Promise<unknown>) => {
        await run("Couldn't send your answer", send);
        // whatever happened, the values go: the request is used once
        setValues(e().fields.map(() => ""));
        props.onDone();
    };

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`Sign in on ${e().site}`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>lock</PaperIcon>
                    <PaperFlex gap="onefourth">
                        <PaperText preset="label">
                            Sign in on <strong>{e().site}</strong>
                        </PaperText>
                        <PaperText preset="hint">
                            {props.name} picked these fields in its browser. It never sees what you type here.
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <Switch>
                    <Match when={e().status === "waiting"}>
                        <Show
                            when={image()}
                            fallback={
                                <Show when={shot.error()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading the page's picture" />}>
                                    {(err) => <PaperError title="Couldn't load the page's picture" error={err()} action={{ label: "Try again", disabled: shot.loading(), onClick: () => void shot.reload() }} />}
                                </Show>
                            }
                        >
                            <img
                                class={styles.shot}
                                src={`data:image/png;base64,${image()}`}
                                alt={`The sign-in page on ${e().site}, with the fields ${props.name} picked numbered`}
                            />
                        </Show>
                        <form
                            onSubmit={(ev) => {
                                ev.preventDefault();
                                void answer(() => props.agent.calls.signIn({ id: e().id, values: values() }));
                            }}
                        >
                            <PaperFlex gap="half">
                                <For each={e().fields}>
                                    {(f, i) => (
                                        <PaperInput
                                            name={`sign-in-${i()}`}
                                            fullWidth
                                            label={`${i() + 1}. ${f.label}`}
                                            type={f.secret ? "password" : "text"}
                                            autocomplete="off"
                                            maxLength={LIMITS.signIn.valueChars}
                                            value={values()[i()] ?? ""}
                                            onInput={(ev) => setValue(i(), ev.currentTarget.value)}
                                            disabled={busy()}
                                        />
                                    )}
                                </For>
                                <PaperFlex direction="row" justify="flex-end" gap="half">
                                    <PaperButton variant="text" type="button" disabled={busy()} onClick={() => void answer(() => props.agent.calls.declineSignIn({ id: e().id }))}>
                                        Not now
                                    </PaperButton>
                                    <PaperButton type="submit" disabled={busy()}>
                                        Sign in
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </form>
                    </Match>
                    <Match when={e().status === "submitting"}>
                        <PaperLoader loaderStatus="indeterminate" label="Signing in" />
                    </Match>
                    <Match when={e().status === "submitted"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">
                                Sent to {e().site}. {props.name} will check whether it worked.
                            </PaperText>
                        </PaperFlex>
                    </Match>
                </Switch>
                <RequestEnd entry={e()} name={props.name} failed="Not signed in" />
            </PaperCard>
        </PaperFlex>
    );
}
