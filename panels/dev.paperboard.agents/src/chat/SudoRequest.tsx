import { Match, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperCard, PaperCode, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperText, createAction } from "@mileniumhq/paperui";
import { LIMITS, type SudoEntry } from "../contract";
import type { Agent } from "../lib/agent";
import RequestEnd from "./RequestEnd";
import type { SignInDraft } from "./SignIn";

/**
 * The agent asking to run one command as administrator. The card shows exactly what runs; the password goes
 * from here to the system's sudo for that command only: the agent never sees it, and it's kept nowhere, so the
 * draft holds it only while the card waits.
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
                if (status !== "waiting" && status !== "running") props.onDone();
            },
        ),
    );

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`${props.name} asks to run a command as administrator`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>admin_panel_settings</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">{props.name} asks to run this as administrator</PaperText>
                        <PaperText preset="hint" breakWord>
                            {e().reason}
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>
                <PaperCode block lang="bash" wrap>
                    {e().command}
                </PaperCode>
                <PaperText preset="hint" breakWord>
                    In {e().folder}
                </PaperText>

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
                                    maxLength={LIMITS.access.passwordChars}
                                    value={password()}
                                    onInput={(ev) => type(ev.currentTarget.value)}
                                    error={e().error}
                                    disabled={busy()}
                                />
                                <PaperText preset="hint">
                                    Only this command runs, once. Your password goes to your system's sudo for it and isn't kept. {props.name} never sees it.
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
                                        Run it
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </form>
                    </Match>
                    <Match when={e().status === "running"}>
                        <PaperLoader loaderStatus="indeterminate" label="Running as administrator" />
                    </Match>
                    <Match when={e().status === "done"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>{e().exitCode === 0 ? "check" : "info"}</PaperIcon>
                            <PaperText preset="hint">{e().exitCode === 0 ? "It ran." : `It ran and exited with ${e().exitCode}.`} {props.name} has its output.</PaperText>
                        </PaperFlex>
                    </Match>
                </Switch>
                <RequestEnd entry={e()} name={props.name} failed="The command didn't finish" />
            </PaperCard>
        </PaperFlex>
    );
}
