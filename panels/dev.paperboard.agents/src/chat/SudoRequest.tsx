import { Match, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperText, createAction } from "@mileniumhq/paperui";
import type { SudoEntry } from "../contract";
import type { Agent } from "../lib/agent";
import RequestEnd from "./RequestEnd";
import type { SignInDraft } from "./SignIn";

/**
 * The agent asking to use sudo in one of its shells. The password goes from here straight to sudo's prompt in
 * that shell: the agent never sees it, and it's kept nowhere, so the draft holds it only while the card waits.
 */
export default function SudoRequest(props: { agent: Agent; entry: SudoEntry; name: string; draft: SignInDraft; onDone: () => void }) {
    const e = () => props.entry;
    const [password, setPassword] = createSignal(props.draft.values[0] ?? "");
    const { busy, run } = createAction();

    const type = (v: string) => {
        setPassword(v);
        props.draft.values = [v];
    };
    const forget = () => {
        setPassword("");
        props.draft.values = [];
    };
    const send = () => {
        const typed = password();
        // used once: gone from the card before it's even answered
        forget();
        void run("Couldn't send your password", () => props.agent.calls.answerSudo({ id: e().id, password: typed }));
    };
    createEffect(
        on(
            () => e().status,
            (status) => {
                if (status !== "waiting" && status !== "checking") props.onDone();
            },
        ),
    );

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`${props.name} asks to use sudo`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>admin_panel_settings</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">{props.name} asks to use sudo</PaperText>
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
                                send();
                            }}
                        >
                            <PaperFlex gap="half">
                                <PaperInput
                                    name="sudo-password"
                                    label="Password"
                                    icon="key"
                                    type="password"
                                    autocomplete="current-password"
                                    fullWidth
                                    maxLength={1024}
                                    value={password()}
                                    onInput={(ev) => type(ev.currentTarget.value)}
                                    error={e().error}
                                    disabled={busy()}
                                />
                                <PaperText preset="hint">
                                    Your password goes straight to sudo in {props.name}'s shell and isn't kept. {props.name} never sees it.
                                </PaperText>
                                <PaperFlex direction="row" justify="flex-end" gap="half">
                                    <PaperButton
                                        variant="text"
                                        type="button"
                                        disabled={busy()}
                                        onClick={() => {
                                            forget();
                                            void run("Couldn't send your answer", () => props.agent.calls.declineSudo({ id: e().id }));
                                        }}
                                    >
                                        Not now
                                    </PaperButton>
                                    <PaperButton type="submit" disabled={busy() || !password()}>
                                        Allow sudo
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </form>
                    </Match>
                    <Match when={e().status === "checking"}>
                        <PaperLoader loaderStatus="indeterminate" label="Checking with sudo" />
                    </Match>
                    <Match when={e().status === "allowed"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">sudo is unlocked in that shell for a few minutes after each use.</PaperText>
                        </PaperFlex>
                    </Match>
                </Switch>
                <RequestEnd entry={e()} name={props.name} failed="sudo isn't unlocked" />
            </PaperCard>
        </PaperFlex>
    );
}
