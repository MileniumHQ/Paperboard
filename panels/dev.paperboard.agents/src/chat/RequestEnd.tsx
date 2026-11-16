import { Show } from "solid-js";
import { PaperFlex, PaperIcon, PaperText } from "@mileniumhq/paperui";

/**
 * How every request card in the chat ends, whatever it asked: refused, lapsed, or failed at the service
 * (told under the card's own `failed` title). It's the card's record in the conversation, so a failure is
 * the card's own line, like its other endings, not an alert.
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
                {(title) => (
                    <PaperFlex direction="row" align="start" gap="half" data-card-error>
                        <PaperIcon>error</PaperIcon>
                        <PaperText preset="hint" color="danger" breakWord>
                            {title()}: {props.entry.error}. {props.name} was told and can ask again.
                        </PaperText>
                    </PaperFlex>
                )}
            </Show>
        </>
    );
}
