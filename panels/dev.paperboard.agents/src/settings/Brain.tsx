// What a brain is doing on this computer, as the person sees it: downloading,
// waiting for them to sign in, or in trouble. The service owns all of it
// (state.brains); this only shows it and sends the person's answers back.

import { Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { catchLoopbackRedirect, LoopbackRedirectError } from "@mileniumhq/paperapi";
import { PaperButton, PaperCopyButton, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperModal, PaperProgress, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { SIGN_IN_REQUIRED, type BrainState, type Harness } from "../contract";
import type { Agent } from "../lib/agent";
import { harnessName } from "../lib/brains";
import { failure, type Failure } from "../lib/failure";

/** Who a brain is signed in as. An email is who; anything else (ChatGPT, a provider's name) is how. */
export function signedInLine(b: BrainState): string {
    return b.account ? `Signed in ${b.account.includes("@") ? "as" : "with"} ${b.account}.` : "Signed in.";
}

/** The brain's one line: where it stands. */
export function brainLine(harness: Harness, b: BrainState): string {
    switch (b.phase) {
        case "none":
            return "Not installed.";
        case "unsupported":
            return "Can't run on this computer.";
        case "installing":
            return b.percent === null ? "Installing…" : `Installing… ${b.percent}%`;
        case "signing-in":
            return "Signing in…";
        case "failed":
            return "Stopped with a problem.";
        case "installed":
            return `Installed${b.version ? ` (${b.version})` : ""}. Sign in to use it.`;
        case "ready":
            return [
                b.signedIn ? signedInLine(b) : SIGN_IN_REQUIRED[harness] ? "Ready." : "Ready, with its free models.",
                b.version ? `Version ${b.version}.` : "",
                b.updateWaiting ? "An update installs when the agent next stops." : "",
            ]
                .filter(Boolean)
                .join(" ");
    }
}

/** The actions a person can ask of a brain; a refused one is kept to show. */
export function createBrainActions(agent: Agent) {
    const [error, setError] = createSignal<Failure | null>(null);
    const act = async (title: string, run: () => Promise<unknown>) => {
        setError(null);
        try {
            await run();
        } catch (e) {
            setError(failure(title, e));
        }
    };
    return {
        error,
        install: (h: Harness) => act(`${harnessName(h)} not installed`, () => agent.installBrain(h)),
        signIn: (h: Harness) => act(`${harnessName(h)} not signed in`, () => agent.signInBrain(h)),
        cancel: (h: Harness) => act("Sign-in not stopped", () => agent.cancelBrainSignIn(h)),
        signOut: (h: Harness) => act(`${harnessName(h)} not signed out`, () => agent.signOutBrain(h)),
        submitCode: (h: Harness, code: string) => act("Code not accepted", () => agent.brainCode(h, code)),
        finishAt: (h: Harness, address: string) => act("Sign-in not finished", () => agent.brainAddress(h, address)),
    };
}
export type BrainActions = ReturnType<typeof createBrainActions>;

/** What's happening with a brain right now, if anything is: the download, the sign-in, or the trouble. */
export function BrainStatus(props: { agent: Agent; harness: Harness; actions: BrainActions }) {
    const b = () => props.agent.state.brains[props.harness];
    const name = () => harnessName(props.harness);

    return (
        <PaperFlex gap="half">
            <Switch>
                <Match when={b().phase === "installing"}>
                    <PaperText preset="hint">
                        Downloading {name()}. It comes straight from its maker and is checked before it's used.
                    </PaperText>
                    <PaperProgress value={b().percent ?? undefined} aria-label={`Installing ${name()}`} />
                </Match>
                <Match when={b().phase === "signing-in"}>
                    <SignInSteps agent={props.agent} harness={props.harness} actions={props.actions} />
                    <PaperFlex direction="row" gap="half">
                        <PaperButton variant="text" onClick={() => void props.actions.cancel(props.harness)}>
                            Cancel
                        </PaperButton>
                    </PaperFlex>
                </Match>
                <Match when={b().phase === "failed" || b().phase === "unsupported"}>
                    <PaperQuote variant="danger" icon="error" title={`${name()} not ready`} role="alert">
                        {b().error}
                    </PaperQuote>
                </Match>
            </Switch>
            <Show when={props.actions.error()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
        </PaperFlex>
    );
}

/**
 * A sign-in, one thing at a time: the page to continue to, then waiting for
 * the person to finish there. A code field shows only when the brain asks for
 * one. A brain whose page comes back to a loopback address (Codex) gets that
 * address from this device when the brain runs on another computer, so the
 * sign-in finishes there; where it can't be caught (Paperboard in a web
 * browser), the person pastes it.
 */
export function SignInSteps(props: { agent: Agent; harness: Harness; actions: BrainActions }) {
    const b = () => props.agent.state.brains[props.harness];
    const name = () => harnessName(props.harness);
    // the page was opened: waiting is the one thing left to show
    const [opened, setOpened] = createSignal(false);
    createEffect(on(() => b().login?.url, () => setOpened(false)));

    // "paste" when the address the browser ends on has to be pasted here
    const [forward, setForward] = createSignal<"none" | "listening" | "paste">("none");
    const [forwardError, setForwardError] = createSignal<string | null>(null);
    createEffect(
        on(
            () => b().login?.callback ?? null,
            (callback) => {
                setForward("none");
                setForwardError(null);
                if (!callback) return;
                const stop = new AbortController();
                onCleanup(() => stop.abort());
                setForward("listening");
                catchLoopbackRedirect(callback, { signal: stop.signal }).then(
                    async (result) => {
                        if (stop.signal.aborted) return;
                        // on this device the brain's own listener hears the browser
                        if (result.status === "local") return setForward("none");
                        await props.actions.finishAt(props.harness, result.url);
                        // an address the brain refused can still be pasted again
                        if (props.actions.error()) setForward("paste");
                    },
                    (e) => {
                        if (stop.signal.aborted) return;
                        setForward("paste");
                        // no listener here (a web browser) is why there's a field, not a failure
                        if (!(e instanceof LoopbackRedirectError && e.code === "unavailable")) setForwardError(e instanceof Error ? e.message : String(e));
                    },
                );
            },
        ),
    );

    const [code, setCode] = createSignal("");
    const sendCode = async () => {
        const value = code().trim();
        if (!value) return;
        await props.actions.submitCode(props.harness, value);
        // the code is used once: it doesn't stay in the field
        setCode("");
    };
    const [address, setAddress] = createSignal("");
    const sendAddress = async () => {
        const value = address().trim();
        if (!value) return;
        await props.actions.finishAt(props.harness, value);
        if (!props.actions.error()) setAddress("");
    };

    return (
        <Show when={b().login} fallback={<PaperLoader loaderStatus="indeterminate" label={`Getting ${name()}'s sign-in page`} />}>
            {(login) => (
                <Show
                    when={opened() || !login().url}
                    fallback={
                        <PaperFlex gap="full" align="start">
                            <PaperText preset="body">
                                Sign in to {name()} with your account in your browser.
                                {login().code ? " The page asks for this code." : ""}
                            </PaperText>
                            <Show when={login().code}>
                                {(shown) => (
                                    <PaperFlex direction="row" gap="half" align="center">
                                        <PaperText preset="title">{shown()}</PaperText>
                                        <PaperCopyButton text={shown()} label="Copy code" variant="text" />
                                    </PaperFlex>
                                )}
                            </Show>
                            <PaperFlex direction="row" gap="half" align="center">
                                <PaperButton variant="primary" href={login().url!} target="_blank" onClick={() => setOpened(true)}>
                                    Continue in your browser <PaperIcon>open_in_new</PaperIcon>
                                </PaperButton>
                                <PaperCopyButton text={login().url!} label="Copy link" variant="text" />
                            </PaperFlex>
                        </PaperFlex>
                    }
                >
                    <PaperFlex gap="full">
                        <PaperLoader loaderStatus="indeterminate" label="Waiting for you to finish signing in" />
                        <Show when={login().expectsCode}>
                            <PaperFlex gap="half">
                                <PaperText preset="hint">When you've signed in, the page shows a code. Paste it here.</PaperText>
                                <PaperInput
                                    label="Code"
                                    fullWidth
                                    autocomplete="off"
                                    value={code()}
                                    onInput={(e) => setCode(e.currentTarget.value)}
                                    onKeyDown={(e) => e.key === "Enter" && void sendCode()}
                                />
                                <PaperFlex direction="row" gap="half">
                                    <PaperButton variant="primary" disabled={!code().trim()} onClick={() => void sendCode()}>
                                        Continue
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </Show>
                        <Show when={forward() === "paste"}>
                            <PaperFlex gap="half">
                                <Show when={forwardError()}>
                                    {(shown) => (
                                        <PaperQuote variant="warning" icon="warning" title="Your browser can't come back here by itself">
                                            {shown()}
                                        </PaperQuote>
                                    )}
                                </Show>
                                <PaperText preset="hint">When you've signed in, your browser ends on a page that doesn't load. Copy that page's address and paste it here.</PaperText>
                                <PaperInput
                                    label="Address"
                                    fullWidth
                                    autocomplete="off"
                                    value={address()}
                                    onInput={(e) => setAddress(e.currentTarget.value)}
                                    onKeyDown={(e) => e.key === "Enter" && void sendAddress()}
                                />
                                <PaperFlex direction="row" gap="half">
                                    <PaperButton variant="primary" disabled={!address().trim()} onClick={() => void sendAddress()}>
                                        Continue
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </Show>
                        <Show when={login().url}>
                            {(url) => (
                                <PaperFlex direction="row" gap="half" align="center">
                                    <PaperButton variant="text" href={url()} target="_blank">
                                        Open the page again
                                    </PaperButton>
                                    <PaperCopyButton text={url()} label="Copy link" variant="text" />
                                </PaperFlex>
                            )}
                        </Show>
                    </PaperFlex>
                </Show>
            )}
        </Show>
    );
}

/**
 * Signing in to a brain from settings: it starts when the modal opens and
 * shows one step at a time, ending on who it's signed in as. Closing it before
 * then stops the sign-in.
 */
export function SignInModal(props: { agent: Agent; harness: Harness | null; actions: BrainActions; onClose: () => void }) {
    const b = () => (props.harness ? props.agent.state.brains[props.harness] : undefined);
    const done = () => b()?.phase === "ready" && b()!.signedIn;
    createEffect(
        on(
            () => props.harness,
            (h) => {
                // a sign-in already under way is shown, not started again
                if (h && b()?.phase !== "signing-in") void props.actions.signIn(h);
            },
        ),
    );
    const close = () => {
        if (props.harness && b()?.phase === "signing-in") void props.actions.cancel(props.harness);
        props.onClose();
    };
    return (
        <PaperModal
            open={props.harness !== null}
            onClose={close}
            size="small"
            title={props.harness ? `Sign in to ${harnessName(props.harness)}` : ""}
            footer={
                <Show
                    when={done()}
                    fallback={
                        <PaperButton variant="text" onClick={close}>
                            Cancel
                        </PaperButton>
                    }
                >
                    <PaperButton variant="primary" onClick={close}>
                        Done
                    </PaperButton>
                </Show>
            }
        >
            <Show when={props.harness}>
                {(h) => (
                    <PaperFlex gap="full">
                        <Switch>
                            <Match when={b()!.phase === "signing-in"}>
                                <SignInSteps agent={props.agent} harness={h()} actions={props.actions} />
                            </Match>
                            <Match when={done()}>
                                <PaperFlex direction="row" gap="half" align="center">
                                    <PaperIcon>check_circle</PaperIcon>
                                    <PaperText preset="body">{signedInLine(b()!)}</PaperText>
                                </PaperFlex>
                            </Match>
                            <Match when={b()!.phase === "failed"}>
                                <PaperQuote variant="danger" icon="error" title={`${harnessName(h())} not signed in`} role="alert">
                                    {b()!.error}
                                </PaperQuote>
                                <PaperFlex direction="row" gap="half">
                                    <PaperButton variant="primary" onClick={() => void props.actions.signIn(h())}>
                                        Try again
                                    </PaperButton>
                                </PaperFlex>
                            </Match>
                        </Switch>
                        <Show when={props.actions.error()}>
                            {(shown) => (
                                <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                    {shown().message}
                                </PaperQuote>
                            )}
                        </Show>
                    </PaperFlex>
                )}
            </Show>
        </PaperModal>
    );
}

/** The buttons that move a brain along: install, sign in, sign out, or the providers screen. */
export function BrainButtons(props: { agent: Agent; harness: Harness; actions: BrainActions; onProviders: () => void; onSignIn?: (h: Harness) => void }) {
    const signIn = () => (props.onSignIn ? props.onSignIn(props.harness) : void props.actions.signIn(props.harness));
    const b = () => props.agent.state.brains[props.harness];
    return (
        <PaperFlex direction="row" gap="half" align="center">
            <Switch>
                <Match when={b().phase === "none" || (b().phase === "failed" && !b().installed)}>
                    <PaperButton variant="primary" onClick={() => void props.actions.install(props.harness)}>
                        <PaperIcon>download</PaperIcon> {b().phase === "failed" ? "Try again" : "Install"}
                    </PaperButton>
                </Match>
                <Match when={b().phase === "failed" && b().installed && !SIGN_IN_REQUIRED[props.harness]}>
                    <PaperButton onClick={() => void props.actions.install(props.harness)}>Try again</PaperButton>
                </Match>
                <Match when={b().phase === "installed" || (b().phase === "failed" && b().installed && SIGN_IN_REQUIRED[props.harness])}>
                    <PaperButton variant="primary" onClick={signIn}>
                        <PaperIcon>login</PaperIcon> Sign in
                    </PaperButton>
                </Match>
                <Match when={b().phase === "signing-in" && props.onSignIn}>
                    <PaperButton onClick={signIn}>Continue signing in</PaperButton>
                </Match>
                <Match when={b().phase === "ready"}>
                    <Show when={props.harness === "opencode"}>
                        <PaperButton onClick={props.onProviders}>
                            <PaperIcon>hub</PaperIcon> Providers
                        </PaperButton>
                    </Show>
                    <Show when={SIGN_IN_REQUIRED[props.harness]}>
                        <PaperButton variant="text" onClick={() => void props.actions.signOut(props.harness)}>
                            Sign out
                        </PaperButton>
                    </Show>
                </Match>
            </Switch>
        </PaperFlex>
    );
}
