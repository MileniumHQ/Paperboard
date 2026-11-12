// Signing in to a tool server: the page to continue to, then waiting for the
// browser to come back. On this computer the service hears it; on another
// device the panel catches it here and hands it over. Where nothing can catch
// it (Paperboard in a web browser, with the agent elsewhere), the address is
// pasted. Shown on the Tools page and on the sign-in card in the chat.

import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { catchLoopbackRedirect, LoopbackRedirectError } from "@mileniumhq/paperapi";
import { PaperButton, PaperCopyButton, PaperFlex, PaperIcon, PaperInput, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { errorText } from "../lib/failure";
import { submitOnPaste } from "../lib/paste";
import type { Tools } from "./api";

export default function SignInSteps(props: { tools: Tools; name: string }) {
    const pending = () => props.tools.view()?.signIns[props.name] ?? null;
    const [paste, setPaste] = createSignal(false);
    const [address, setAddress] = createSignal("");
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);

    createEffect(
        on(
            () => pending()?.callback ?? null,
            (callback) => {
                setPaste(false);
                setError(null);
                if (!callback) return;
                const stop = new AbortController();
                onCleanup(() => stop.abort());
                catchLoopbackRedirect(callback, { signal: stop.signal }).then(
                    async (result) => {
                        if (stop.signal.aborted || result.status === "local") return;
                        try {
                            await props.tools.finishSignIn(props.name, result.url);
                        } catch (e) {
                            setError(errorText(e));
                        }
                    },
                    (e) => {
                        if (stop.signal.aborted) return;
                        setPaste(true);
                        if (!(e instanceof LoopbackRedirectError && e.code === "unavailable")) setError(errorText(e));
                    },
                );
            },
        ),
    );

    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

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
                                <PaperQuote variant="danger" icon="error" title="Not signed in" role="alert">
                                    {p().error}
                                </PaperQuote>
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
                            when={paste()}
                            fallback={<PaperLoader loaderStatus="indeterminate" label="Waiting for you to sign in" />}
                        >
                            <Show when={!busy()} fallback={<PaperLoader loaderStatus="indeterminate" label="Finishing the sign-in" />}>
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
                    <Show when={error()}>
                        <PaperQuote variant="danger" icon="error" title="Not signed in" role="alert">
                            {error()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            )}
        </Show>
    );
}
