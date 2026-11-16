import { Show } from "solid-js";
import { PaperCode, PaperFlex } from "@mileniumhq/paperui";
import { splitFailure } from "../lib/failure";

/**
 * What the tool that failed printed after its first line (SteamCMD, an
 * installer), preformatted and scrolling when it is long. Nothing when it
 * printed nothing more. The first line is the failure's toast.
 */
export default function FailureOutput(props: { message: string }) {
    return (
        <Show when={splitFailure(props.message).output}>
            {(output) => (
                <PaperFlex fullWidth maxHeight="panel-height-small" overflowY="auto" overflowX="hidden">
                    <PaperCode block language="text">
                        {output()}
                    </PaperCode>
                </PaperFlex>
            )}
        </Show>
    );
}
