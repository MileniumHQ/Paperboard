// What a brain is doing on this computer, as the person sees it: downloading,
// waiting for them to sign in, or in trouble. The service owns all of it
// (state.brains); this only shows it and sends the person's answers back.

import { Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperCopyButton, PaperFlex, PaperIcon, PaperInput, PaperLink, PaperLoader, PaperProgress, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { SIGN_IN_REQUIRED, type BrainState, type Harness } from "../contract";
import type { Agent } from "../lib/agent";
import { harnessName } from "../lib/brains";
import { failure, type Failure } from "../lib/failure";

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
                // an email is who; anything else (ChatGPT, a provider's name) is how
                b.signedIn ? (b.account ? `Signed in ${b.account.includes("@") ? "as" : "with"} ${b.account}.` : "Signed in.") : SIGN_IN_REQUIRED[harness] ? "Ready." : "Ready, with its free models.",
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
        signIn: (h: Harness, method?: "browser" | "code") => act(`${harnessName(h)} not signed in`, () => agent.signInBrain(h, method)),
        cancel: (h: Harness) => act("Sign-in not stopped", () => agent.cancelBrainSignIn(h)),
        signOut: (h: Harness) => act(`${harnessName(h)} not signed out`, () => agent.signOutBrain(h)),
        submitCode: (h: Harness, code: string) => act("Code not accepted", () => agent.brainCode(h, code)),
    };
}
export type BrainActions = ReturnType<typeof createBrainActions>;

/** What's happening with a brain right now, if anything is: the download, the sign-in, or the trouble. */
export function BrainStatus(props: { agent: Agent; harness: Harness; actions: BrainActions }) {
    const b = () => props.agent.state.brains[props.harness];
    const name = () => harnessName(props.harness);
    const [code, setCode] = createSignal("");
    const send = async () => {
        const value = code().trim();
        if (!value) return;
        await props.actions.submitCode(props.harness, value);
        // the code is used once: it doesn't stay in the field
        setCode("");
    };

    return (
        <PaperFlex gap="half">
            <Switch>
                <Match when={b().phase === "installing"}>
                    <PaperText size={1} color="text-muted">
                        Downloading {name()}. It comes straight from its maker and is checked before it's used.
                    </PaperText>
                    <PaperProgress value={b().percent ?? undefined} aria-label={`Installing ${name()}`} />
                </Match>
                <Match when={b().phase === "signing-in"}>
                    <Show
                        when={b().login}
                        fallback={<PaperLoader loaderStatus="indeterminate" label={`Waiting for ${name()}'s sign-in page`} />}
                    >
                        {(login) => (
                            <>
                                <PaperText size={1} color="text-muted">
                                    {login().expectsCode
                                        ? "A browser window should have opened. If it didn't, open the sign-in page yourself, sign in, and paste the code it shows."
                                        : login().code
                                          ? "Open the sign-in page and enter this code."
                                          : "A browser window should have opened. If it didn't, open the sign-in page yourself."}
                                </PaperText>
                                <PaperFlex direction="row" gap="half" align="center">
                                    <Show when={login().url}>
                                        {(url) => (
                                            <>
                                                <PaperLink href={url()}>Open the sign-in page</PaperLink>
                                                <PaperCopyButton text={url()} label="Copy link" variant="text" />
                                            </>
                                        )}
                                    </Show>
                                </PaperFlex>
                                <Show when={login().code}>
                                    {(shown) => (
                                        <PaperFlex direction="row" gap="half" align="center">
                                            <PaperText preset="title">
                                                {shown()}
                                            </PaperText>
                                            <PaperCopyButton text={shown()} label="Copy code" variant="text" />
                                        </PaperFlex>
                                    )}
                                </Show>
                                <Show when={login().expectsCode}>
                                    <PaperInput
                                        label="Code from the page"
                                        fullWidth
                                        autocomplete="off"
                                        value={code()}
                                        onInput={(e) => setCode(e.currentTarget.value)}
                                        onKeyDown={(e) => e.key === "Enter" && void send()}
                                    />
                                    <PaperFlex direction="row" gap="half">
                                        <PaperButton variant="primary" disabled={!code().trim()} onClick={() => void send()}>
                                            Continue
                                        </PaperButton>
                                    </PaperFlex>
                                </Show>
                                <PaperLoader loaderStatus="indeterminate" label={`Waiting for you to finish signing in`} />
                            </>
                        )}
                    </Show>
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

/** The buttons that move a brain along: install, sign in, sign out, or the providers screen. */
export function BrainButtons(props: { agent: Agent; harness: Harness; actions: BrainActions; onProviders: () => void }) {
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
                    <PaperButton variant="primary" onClick={() => void props.actions.signIn(props.harness)}>
                        <PaperIcon>login</PaperIcon> Sign in
                    </PaperButton>
                    <Show when={props.harness === "codex"}>
                        <PaperButton variant="text" onClick={() => void props.actions.signIn(props.harness, "code")}>
                            Use a code instead
                        </PaperButton>
                    </Show>
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
