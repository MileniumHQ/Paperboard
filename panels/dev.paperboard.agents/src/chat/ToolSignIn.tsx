import { Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { ToolSignInEntry } from "../contract";
import { failure, type Failure } from "../lib/failure";
import { createTools } from "../tools/api";
import SignInSteps from "../tools/SignInSteps";
import { stateOf, stateText } from "../tools/status";

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
    const host = () => {
        try {
            return new URL(e().url).host;
        } catch (err) {
            console.warn("[agents] a tool server's address isn't a URL:", e().url, err);
            return e().url;
        }
    };
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<Failure | null>(null);
    const act = async (title: string, fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(failure(title, err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={`Sign in to ${e().server}`} data-message={e().id}>
                <PaperFlex direction="row" align="start" gap="half">
                    <PaperIcon>login</PaperIcon>
                    <PaperFlex gap="onefourth" minWidth={0}>
                        <PaperText preset="label">Sign in to {e().server}</PaperText>
                        <PaperText preset="hint" breakWord>
                            {props.name} needs you to sign in at {host()} to use its tools.
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>

                <Switch>
                    <Match when={tools.load() === "failed"}>
                        <PaperQuote variant="danger" icon="error" title="Tools can't be read" role="alert">
                            {tools.loadError()}
                        </PaperQuote>
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
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Sign-in not started", () => tools.signIn(e().server))}>
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
                            <PaperFlex gap="half">
                                <PaperQuote variant="danger" icon="error" title={`${e().server} didn't start`} role="alert">
                                    {why()}
                                </PaperQuote>
                                <PaperFlex direction="row">
                                    <PaperButton disabled={busy()} onClick={() => void act("Server not started", () => tools.restart(e().server))}>
                                        <PaperIcon>refresh</PaperIcon> Try again
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        )}
                    </Match>
                    <Match when={state()}>{(s) => <PaperText preset="hint">{stateText(s())}</PaperText>}</Match>
                </Switch>
                <Show when={error()}>
                    {(shown) => (
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                            {shown().message}
                        </PaperQuote>
                    )}
                </Show>
            </PaperCard>
        </PaperFlex>
    );
}
