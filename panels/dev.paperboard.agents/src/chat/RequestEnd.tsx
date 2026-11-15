import { Show } from "solid-js";
import { PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { Failure } from "../lib/failure";

/**
 * How every request card in the chat ends, whatever it asked: refused, lapsed, failed at the service
 * (told under the card's own `failed` title), and an answer that never reached the service.
 */
export default function RequestEnd(props: { entry: { status: string; error?: string }; name: string; failed?: string; error: Failure | null }) {
    return (
        <>
            <Show when={props.entry.status === "declined"}>
                <PaperText preset="hint">You said no.</PaperText>
            </Show>
            <Show when={props.entry.status === "expired"}>
                <PaperText preset="hint">This request lapsed. {props.name} can ask again.</PaperText>
            </Show>
            <Show when={props.entry.status === "failed" && props.failed}>
                {(title) => (
                    <PaperQuote variant="danger" icon="error" title={title()} role="alert">
                        {props.entry.error}. {props.name} was told and can ask again.
                    </PaperQuote>
                )}
            </Show>
            <Show when={props.error}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
        </>
    );
}
