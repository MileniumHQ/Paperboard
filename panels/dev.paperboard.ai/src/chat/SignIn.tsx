import { For, Match, Show, Switch, createSignal, onMount } from "solid-js";
import { PaperButton, PaperIcon, PaperInput } from "@mileniumhq/paperui";
import { LIMITS, type SignInEntry } from "../contract";
import type { Agent } from "../lib/agent";
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
    const [image, setImage] = createSignal<string | null>(props.draft.image);
    const [shotError, setShotError] = createSignal<string | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);

    const loadShot = () => {
        setShotError(null);
        props.agent.signInShot(e().id).then(
            (r) => setImage((props.draft.image = r.image)),
            (err) => setShotError(err instanceof Error ? err.message : String(err)),
        );
    };
    onMount(() => {
        if (e().status === "waiting" && !image()) loadShot();
    });

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
            (err) => setError(err instanceof Error ? err.message : String(err)),
        ).finally(() => {
            setBusy(false);
            // whatever happened, the values go: the request is used once
            setValues(e().fields.map(() => ""));
            props.onDone();
        });
    };

    return (
        <section class={styles.card} aria-label={`Sign in on ${e().site}`} data-message={e().id}>
            <div class={styles.head}>
                <PaperIcon>lock</PaperIcon>
                <div>
                    <p class={styles.title}>
                        Sign in on <strong>{e().site}</strong>
                    </p>
                    <p class={styles.sub}>{props.name} picked these fields in its browser. It never sees what you type here.</p>
                </div>
            </div>

            <Switch>
                <Match when={e().status === "waiting"}>
                    <Show
                        when={image()}
                        fallback={
                            <Show when={shotError()} fallback={<div class={styles.shotLoading}>Loading the page's picture…</div>}>
                                <p class={styles.error} role="alert">
                                    <PaperIcon>error</PaperIcon> {shotError()}
                                    <PaperButton variant="text" onClick={loadShot}>
                                        Try again
                                    </PaperButton>
                                </p>
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
                        class={styles.form}
                        onSubmit={(ev) => {
                            ev.preventDefault();
                            answer(() => props.agent.signIn(e().id, values()));
                        }}
                    >
                        <For each={e().fields}>
                            {(f, i) => (
                                <PaperInput
                                    name={`sign-in-${i()}`}
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
                        <div class={styles.actions}>
                            <PaperButton variant="text" type="button" disabled={busy()} onClick={() => answer(() => props.agent.declineSignIn(e().id))}>
                                Not now
                            </PaperButton>
                            <PaperButton type="submit" disabled={busy()}>
                                Sign in
                            </PaperButton>
                        </div>
                    </form>
                </Match>
                <Match when={e().status === "submitting"}>
                    <p class={styles.status}>Signing in…</p>
                </Match>
                <Match when={e().status === "submitted"}>
                    <p class={styles.status}>
                        <PaperIcon>check</PaperIcon> Sent to {e().site}. {props.name} will check whether it worked.
                    </p>
                </Match>
                <Match when={e().status === "declined"}>
                    <p class={styles.status}>You said no.</p>
                </Match>
                <Match when={e().status === "expired"}>
                    <p class={styles.status}>This request lapsed. {props.name} can ask again.</p>
                </Match>
                <Match when={e().status === "failed"}>
                    <p class={styles.error} role="alert">
                        <PaperIcon>error</PaperIcon> Couldn't sign in: {e().error}. {props.name} was told and can ask again.
                    </p>
                </Match>
            </Switch>
            <Show when={error()}>
                <p class={styles.error} role="alert">
                    <PaperIcon>error</PaperIcon> {error()}
                </p>
            </Show>
        </section>
    );
}
