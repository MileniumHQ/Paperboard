import { Show } from "solid-js";
import { PaperCode, PaperFlex } from "@mileniumhq/paperui";
import { splitFailure } from "../lib/failure";

/**
 * A failure inside its quote: what failed as a sentence, and the output of
 * the tool that failed below it, preformatted and scrolling when it is long.
 */
export default function FailureText(props: { message: string }) {
    const parts = () => splitFailure(props.message);
    return (
        <PaperFlex direction="column" gap="half" fullWidth minWidth={0}>
            {parts().summary}
            <Show when={parts().output}>
                {(output) => (
                    <PaperFlex fullWidth maxHeight="panel-height-small" overflowY="auto" overflowX="hidden">
                        <PaperCode block language="text">
                            {output()}
                        </PaperCode>
                    </PaperFlex>
                )}
            </Show>
        </PaperFlex>
    );
}
