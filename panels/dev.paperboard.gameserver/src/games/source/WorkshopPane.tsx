import { createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperInput, PaperLink, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { formatCount } from "../../lib/addons/presentation";
import { sourceCalls, type SourceGameSpec } from "./index";
import MapCards from "./MapCards";
import { workshopChoice } from "./useWorkshopMaps";
import type { SourceWorkshopHit, SourceWorkshopResults } from "./workshop";
import { workshopName } from "./workshop";

/**
 * The Steam Workshop's maps for a game, searched by name or found by a pasted
 * Workshop link or item id, as picture cards. Choosing one is the parent's to
 * act on (it is added to the server there). Valve's attribution and
 * disclaimers come with every answer and are shown under it.
 */
export default function WorkshopPane(props: {
    spec: SourceGameSpec;
    disabled?: boolean;
    /** the map names the rotation has, to say so on their cards */
    inRotation: readonly string[];
    onPick(map: SourceWorkshopHit): void;
}) {
    const ids = sourceCalls(props.spec.id);
    const [query, setQuery] = createSignal("");
    const [results, setResults] = createSignal<SourceWorkshopResults | null>(null);
    const [searching, setSearching] = createSignal(false);
    const [error, setError] = createSignal("");
    // the answer in view is the last one asked for, whichever search comes back last
    let latest = 0;

    const search = async () => {
        const asked = ++latest;
        setSearching(true);
        setError("");
        try {
            const found = await serverBridge.call<SourceWorkshopResults>(ids.workshopFind, { query: query() }, { timeoutMs: 30_000 });
            if (asked === latest) setResults(found);
        } catch (err) {
            if (asked === latest) setError(errorMessage(err));
        } finally {
            if (asked === latest) setSearching(false);
        }
    };
    // what is popular, until something is asked for
    onMount(() => void search());

    const choices = () => (results()?.items ?? []).map((hit) => workshopChoice(hit, props.inRotation.includes(workshopName(hit.id)) ? "In the rotation" : hit.subscribers === null ? undefined : `${formatCount(hit.subscribers)} subscribers`));
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
                    placeholder="Search the Steam Workshop, or paste a Workshop link"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
                />
                <PaperButton variant="primary" disabled={searching()} onClick={() => void search()}>{searching() ? "Searching..." : "Search"}</PaperButton>
            </PaperFlex>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="The Steam Workshop could not be searched">
                    <PaperFlex direction="column" gap="half" align="flex-start">
                        <span>{error()}</span>
                        <PaperText size={2}>A Workshop link or item id pasted above is looked up on its own, and may still work.</PaperText>
                        <PaperButton onClick={() => void search()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={results()}>
                {(found) => (
                    <>
                        <Show
                            when={found().items.length > 0}
                            fallback={<PaperText size={2} color="text-subtle">{found().hidden > 0 ? "The Workshop has nothing but items that are not maps for that." : "No Workshop maps matched."}</PaperText>}
                        >
                            <MapCards bare maps={choices()} pictures={{ of: () => undefined, titleOf: () => undefined, all: () => [], source: () => null, error: () => "", retry: () => {} }} disabled={props.disabled} onPick={pick} />
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
