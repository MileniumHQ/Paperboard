import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperInput, PaperLink, PaperText, createRead } from "@mileniumhq/paperui";
import { errorMessage } from "../../lib/failure";
import { formatCount } from "../../lib/addons/presentation";
import { type SourceGameSpec } from "./index";
import MapCards from "./MapCards";
import { workshopChoice } from "./useWorkshopMaps";
import type { MapPicturesState } from "./useMapPictures";
import type { SourceWorkshopHit, SourceWorkshopResults } from "./workshop";
import { workshopName } from "./workshop";
import { useServer } from "../../lib/server";

/**
 * The Steam Workshop's maps for a game, searched by name or found by a pasted
 * Workshop link or item id, as picture cards. Choosing one is the parent's to
 * act on (it is added to the server there). Valve's attribution and
 * disclaimers come with every answer and are shown under it.
 */
/** a Workshop hit brings its own picture; there are none to look up */
const NO_PICTURES: MapPicturesState = { of: () => undefined, loading: () => false, titleOf: () => undefined, source: () => null, error: () => "", retry: () => {} };

export default function WorkshopPane(props: {
    spec: SourceGameSpec;
    disabled?: boolean;
    /** the map names the rotation has, to say so on their cards */
    inRotation: readonly string[];
    onPick(map: SourceWorkshopHit): void;
}) {
    const { calls } = useServer();
    const [query, setQuery] = createSignal("");
    // what is popular, until something is asked for; the answer in view is the last one asked for
    const found = createRead((): Promise<SourceWorkshopResults> => calls.sourceWorkshopFind({ query: untrack(query) }), {
        message: errorMessage,
    });
    const results = found.value;
    const searching = found.loading;
    const search = () => found.reload();

    const choices = createMemo(() => (results()?.items ?? []).map((hit) => workshopChoice(hit, props.inRotation.includes(workshopName(hit.id)) ? "In the rotation" : hit.subscribers === null ? undefined : `${formatCount(hit.subscribers)} subscribers`)));
    const pick = (name: string) => {
        const hit = results()?.items.find((h) => workshopName(h.id) === name);
        if (hit) props.onPick(hit);
    };

    return (
        <PaperFlex direction="column" gap="half">
            <PaperFlex direction="row" gap="half" align="center">
                <PaperInput
                    fullWidth
                    icon="search"
                    placeholder="Map or Workshop link"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
                />
                <PaperButton variant="primary" disabled={searching()} onClick={() => void search()}>{searching() ? "Searching..." : "Search"}</PaperButton>
            </PaperFlex>
            {/* above what was found before, which stays */}
            <Show when={found.error()}>
                {(err) => (
                    <>
                        <PaperError title="Couldn't search the Steam Workshop" error={err()} action={{ label: "Try again", disabled: searching(), onClick: () => void search() }} />
                        <Show when={!results()}>
                            <PaperText size={2} color="text-subtle">A Workshop link or item id pasted above is looked up on its own, and may still work.</PaperText>
                        </Show>
                    </>
                )}
            </Show>
            <Show when={results()}>
                {(found) => (
                    <>
                        <Show
                            when={found().items.length > 0}
                            fallback={<PaperText size={2} color="text-subtle">{found().hidden > 0 ? "The Workshop has nothing but items that are not maps for that." : "No Workshop maps matched."}</PaperText>}
                        >
                            <MapCards bare hideMode maps={choices()} pictures={NO_PICTURES} disabled={props.disabled} onPick={pick} />
                        </Show>
                        <Show when={found().hidden > 0 && found().items.length > 0}>
                            <PaperText size={1} color="text-subtle">{found().hidden} {found().hidden === 1 ? "result is" : "results are"} not {found().hidden === 1 ? "a map" : "maps"} and left out.</PaperText>
                        </Show>
                        <Attribution meta={found().meta} />
                    </>
                )}
            </Show>
        </PaperFlex>
    );
}

/** Valve's terms for showing Steam data: the credit, and the disclaimers beside it. */
function Attribution(props: { meta: SourceWorkshopResults["meta"] }) {
    return (
        <PaperFlex direction="column" gap="onefourth">
            <PaperText size={1} color="text-subtle">
                <PaperLink href={props.meta.source} target="_blank">{props.meta.attribution}</PaperLink>
            </PaperText>
            <For each={[props.meta.disclaimer, props.meta.legal]}>
                {(line) => <PaperText size={1} color="text-subtle">{line}</PaperText>}
            </For>
        </PaperFlex>
    );
}
