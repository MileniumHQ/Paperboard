// Signing in to a tool server: the page to continue to, then waiting for the
// browser to come back. On this computer the service hears it; on another
// device the panel catches it here and hands it over. Where nothing can catch
// it (Paperboard in a web browser, with the agent elsewhere), the address is
// pasted. Shown on the Tools page and on the sign-in card in the chat.

import { Show, createSignal } from "solid-js";
import { PaperButton, PaperCopyButton, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperQuote, PaperText, createAction, createFailureToast } from "@mileniumhq/paperui";
import { createLoopbackCatch } from "../lib/loopback";
import { submitOnPaste } from "../lib/paste";
import { toastFailure } from "../lib/toastFailure";
import type { Tools } from "./api";

export default function SignInSteps(props: { tools: Tools; name: string }) {
    const pending = () => props.tools.view()?.signIns[props.name] ?? null;
    const [address, setAddress] = createSignal("");
    const { busy, run: act } = createAction();
    const run = (fn: () => Promise<unknown>) => act(`Couldn't sign in to ${props.name}`, fn, toastFailure);
    // a sign-in that stopped says why for as long as it stands; Start again is here
    createFailureToast(() => pending()?.error, { title: `Couldn't sign in to ${props.name}` });
    const forward = createLoopbackCatch(
        () => pending()?.callback ?? null,
        (url) => run(() => props.tools.finishSignIn(props.name, url)),
    );

    // the address is used once: pasting it sends it, and a refused one can be pasted again
    const send = (value: string) => {
        if (!value.trim() || busy()) return;
        void run(async () => {
            await props.tools.finishSignIn(props.name, value.trim());
            setAddress("");
        });
    };

    return (
        <Show when={pending()}>
            {(p) => (
                <PaperFlex gap="half">
                    <Show
                        when={!p().error}
                        fallback={
                            <PaperFlex gap="half">
                                <PaperText preset="body">The sign-in to {props.name} stopped.</PaperText>
                                <PaperFlex direction="row" gap="half" align="center" wrap>
                                    <PaperButton variant="primary" disabled={busy()} onClick={() => void run(() => props.tools.signIn(props.name))}>
                                        <PaperIcon>refresh</PaperIcon> Start again
                                    </PaperButton>
                                    <PaperButton variant="text" disabled={busy()} onClick={() => void run(() => props.tools.cancelSignIn(props.name))}>
                                        Cancel
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        }
                    >
                        <PaperText preset="body">Sign in to {props.name} in your browser, then come back here.</PaperText>
                        <PaperFlex direction="row" gap="half" align="center" wrap>
                            <PaperButton variant="primary" href={p().url} target="_blank">
                                Open sign-in page <PaperIcon>open_in_new</PaperIcon>
                            </PaperButton>
                            <PaperCopyButton text={p().url} label="Copy link" variant="text" />
                            <PaperButton variant="text" disabled={busy()} onClick={() => void run(() => props.tools.cancelSignIn(props.name))}>
                                Cancel
                            </PaperButton>
                        </PaperFlex>
                        <Show
                            when={forward.paste()}
                            fallback={<PaperLoader loaderStatus="indeterminate" label="Waiting for you to sign in" />}
                        >
                            <Show when={!busy()} fallback={<PaperLoader loaderStatus="indeterminate" label="Finishing the sign-in" />}>
                                <Show when={forward.error()}>
                                    {(why) => (
                                        <PaperQuote variant="warning" icon="warning" title="Your browser can't come back here by itself">
                                            {why()}
                                        </PaperQuote>
                                    )}
                                </Show>
                                <PaperInput
                                    fullWidth
                                    label="Address"
                                    autocomplete="off"
                                    spellcheck={false}
                                    enterkeyhint="go"
                                    value={address()}
                                    onInput={(e) => setAddress(e.currentTarget.value)}
                                    {...submitOnPaste(send)}
                                />
                                <PaperText preset="hint">If the page you end on doesn't load, copy its address and paste it here.</PaperText>
                            </Show>
                        </Show>
                    </Show>
                </PaperFlex>
            )}
        </Show>
    );
}
