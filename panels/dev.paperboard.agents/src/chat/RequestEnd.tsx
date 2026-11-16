import { Show } from "solid-js";
import { PaperError, PaperText } from "@mileniumhq/paperui";

/**
 * How every request card in the chat ends, whatever it asked: refused, lapsed, or failed at the service
 * (told under the card's own `failed` title). It's the card's record in the conversation, so a failure is
 * a PaperError in the card, said every time the chat is opened: a region, not an alert.
 */
export default function RequestEnd(props: { entry: { status: string; error?: string }; name: string; failed?: string }) {
    return (
        <>
            <Show when={props.entry.status === "declined"}>
                <PaperText preset="hint">You said no.</PaperText>
            </Show>
            <Show when={props.entry.status === "expired"}>
                <PaperText preset="hint">This request lapsed. {props.name} can ask again.</PaperText>
            </Show>
            <Show when={props.entry.status === "failed" && props.failed}>
                {(title) => <PaperError title={title()} error={`${props.entry.error}. ${props.name} was told and can ask again.`} />}
            </Show>
        </>
    );
}
