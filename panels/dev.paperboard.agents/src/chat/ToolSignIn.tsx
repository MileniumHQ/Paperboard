import { Match, Switch } from "solid-js";
import { PaperButton, PaperCard, PaperError, PaperFlex, PaperIcon, PaperLoader, PaperText, createAction } from "@mileniumhq/paperui";
import type { ToolSignInEntry } from "../contract";
import { createTools } from "../tools/api";
import SignInSteps from "../tools/SignInSteps";
import { hostOf, stateOf, stateText } from "../tools/status";

/** The agent asking the user to sign in to one of its tool servers. How it's going is read live, so an old card says how it is now. */
export default function ToolSignIn(props: { entry: ToolSignInEntry; name: string }) {
    const tools = createTools();
    const e = () => props.entry;
    const spec = () => tools.view()?.config.servers.find((s) => s.name === e().server) ?? null;
    const state = () => {
        const v = tools.view();
        const s = spec();
        return v && s ? stateOf(v, s) : null;
    };
    const failed = () => {
        const s = state();
        return s?.kind === "failed" ? s.error : null;
    };
    const { busy, run } = createAction();

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`Sign in to ${e().server}`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>login</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">Sign in to {e().server}</PaperText>
                        <PaperText preset="hint" breakWord>
                            {props.name} needs you to sign in at {hostOf(e().url)} to use its tools.
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <Switch>
                    <Match when={tools.load() === "failed" && tools.loadError()}>
                        {(err) => <PaperError title="Couldn't check the sign-in" error={err()} action={{ label: "Try again", onClick: () => void tools.refresh() }} />}
                    </Match>
                    <Match when={!tools.view()}>
                        <PaperLoader loaderStatus="indeterminate" label="Reading the tools" />
                    </Match>
                    <Match when={!spec()}>
                        <PaperText preset="hint">{e().server} was removed.</PaperText>
                    </Match>
                    <Match when={state()?.kind === "signing-in"}>
                        <SignInSteps tools={tools} name={e().server} />
                    </Match>
                    <Match when={state()?.kind === "needs-sign-in"}>
                        <PaperFlex direction="row">
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void run(`Couldn't start signing in to ${e().server}`, () => tools.signIn(e().server))}>
                                <PaperIcon>login</PaperIcon> Sign in
                            </PaperButton>
                        </PaperFlex>
                    </Match>
                    <Match when={state()?.kind === "running"}>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperIcon>check</PaperIcon>
                            <PaperText preset="hint">Signed in · {stateText(state()!)}</PaperText>
                        </PaperFlex>
                    </Match>
                    <Match when={failed()}>
                        {(why) => (
                            <PaperError
                                title={`Couldn't start ${e().server}`}
                                error={why()}
                                action={{ label: "Try again", disabled: busy(), onClick: () => void run(`Couldn't start ${e().server}`, () => tools.restart(e().server)) }}
                            />
                        )}
                    </Match>
                    <Match when={state()}>{(s) => <PaperText preset="hint">{stateText(s())}</PaperText>}</Match>
                </Switch>
            </PaperCard>
        </PaperFlex>
    );
}
