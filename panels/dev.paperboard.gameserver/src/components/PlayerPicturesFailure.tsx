import { Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import type { SteamPictures } from "../lib/steamAvatars";

/** Why players' pictures are missing, above the list that shows them; the list works without them. */
export default function PlayerPicturesFailure(props: { pictures: SteamPictures }) {
    return (
        <Show when={props.pictures.failure()}>
            {(failure) => (
                <PaperQuote variant="warning" icon="image" title="Profile pictures unavailable">
                    <PaperFlex direction="column" gap="half" align="flex-start">
                        <span>{failure().reason}</span>
                        <span>
                            {failure().count === 1 ? "One picture is" : `${failure().count} pictures are`} missing. Players still work without them.
                        </span>
                        <PaperButton onClick={() => props.pictures.retry()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );
}
