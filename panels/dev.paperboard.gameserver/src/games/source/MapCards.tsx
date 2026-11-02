import { createMemo, createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { mapMode, type SourceGameSpec } from "./index";
import type { MapPicturesState } from "./useMapPictures";

/** A map to choose, as a card. */
export interface MapChoice {
    /** what the server calls it: the file name, or workshop/<id> */
    name: string;
    /** the card's title, when the name is no way to know it by */
    title?: string;
    /** its picture, if there is one */
    picture?: string;
    /** what it plays as ("Capture the Flag"); the filter chips group by it */
    mode?: string;
    /** the card's note under the mode */
    note?: string;
}

/** Installed maps as cards, named by the mode their prefix gives. */
export const mapChoices = (spec: SourceGameSpec, names: readonly string[]): MapChoice[] => names.map((name) => ({ name, mode: mapMode(spec, name) }));

/** Where the pictures come from, or why there are none: the line every screen with map pictures carries. */
export function MapPicturesNote(props: { pictures: MapPicturesState }) {
    return (
        <>
            <Show when={props.pictures.error()}>
                <PaperQuote variant="warning" icon="image" title="Map pictures unavailable">
                    <PaperFlex direction="column" gap="half" align="flex-start">
                        <span>{props.pictures.error()} Maps still work without them.</span>
                        <PaperButton onClick={() => props.pictures.retry()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={props.pictures.source()}>
                {(source) => (
                    <PaperText size={1} color="text-subtle">
                        Map pictures from <PaperLink href={source().url} target="_blank">{source().name}</PaperLink>.
                    </PaperText>
                )}
            </Show>
        </>
    );
}

/** A map without a picture says so; it is not given another map's. */
function NoPicture() {
    return (
        <PaperFlex center fullWidth fullHeight direction="column" gap="onefourth">
            <PaperIcon>map</PaperIcon>
            <PaperText size={1} color="text-subtle">No picture</PaperText>
        </PaperFlex>
    );
}

/** A map's file name, which may break after an underscore instead of mid-word. */
export const breakable = (name: string) => <>{name.split(/(?<=_)/).map((part) => <>{part}<wbr /></>)}</>;

const OTHER_MODE = "Other";
const ALL_MODES = "";

/**
 * Maps to choose from as picture cards, searchable and filtered by mode.
 * `value` is the chosen one; picking is the parent's to act on.
 */
export default function MapCards(props: {
    maps: readonly MapChoice[];
    value?: string;
    disabled?: boolean;
    /** wording for the search box */
    placeholder?: string;
    pictures: MapPicturesState;
    /** leave out each card's mode, when every card has the same one */
    hideMode?: boolean;
    onPick(name: string): void;
}) {
    const [query, setQuery] = createSignal("");
    const [mode, setMode] = createSignal<string | null>(null);
    const modeOf = (map: MapChoice) => map.mode ?? OTHER_MODE;
    const modes = createMemo(() => {
        const counts = new Map<string, number>();
        for (const map of props.maps) counts.set(modeOf(map), (counts.get(modeOf(map)) ?? 0) + 1);
        return [...counts].sort(([a], [b]) => (a === OTHER_MODE ? 1 : b === OTHER_MODE ? -1 : a.localeCompare(b)));
    });
    const shown = createMemo(() => {
        const words = query().toLowerCase().split(/\s+/).filter(Boolean);
        return props.maps.filter((map) => {
            if (mode() !== null && modeOf(map) !== mode()) return false;
            const text = `${map.name} ${map.title ?? ""} ${map.mode ?? ""}`.toLowerCase();
            return words.every((word) => text.includes(word));
        });
    });

    return (
        <PaperFlex direction="column" gap="half">
            <PaperFlex direction="row" gap="half" align="center">
                <PaperInput fullWidth icon="search" placeholder={props.placeholder ?? "Search maps"} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
                <Show when={modes().length > 1}>
                    <PaperSelectMenu name="map-mode" placeholder="All modes" value={mode() ?? ALL_MODES} onValueChange={(value) => setMode(value === ALL_MODES ? null : String(value))}>
                        <PaperSelectMenuItem value={ALL_MODES} description={`${props.maps.length} maps`}>All modes</PaperSelectMenuItem>
                        <For each={modes()}>
                            {([name, count]) => <PaperSelectMenuItem value={name} description={`${count} ${count === 1 ? "map" : "maps"}`}>{name}</PaperSelectMenuItem>}
                        </For>
                    </PaperSelectMenu>
                </Show>
            </PaperFlex>
            <Show
                when={shown().length > 0}
                fallback={<PaperEmptyState icon="search" title="No maps match">Try another name or mode.</PaperEmptyState>}
            >
                <PaperMediaCardGroup minCardWidth="field">
                    <For each={shown()}>
                        {(map) => (
                            <PaperMediaCard
                                effect={false}
                                banner={map.picture ?? props.pictures.of(map.name) ?? <NoPicture />}
                                bannerAlt={`${map.title ?? map.name}`}
                                title={map.title ?? breakable(map.name)}
                                subtitle={map.title ? map.name : undefined}
                                description={[props.hideMode ? undefined : map.mode, map.note].filter(Boolean).join(" · ") || undefined}
                                selected={props.value === map.name}
                                disabled={props.disabled}
                                onClick={() => props.onPick(map.name)}
                            />
                        )}
                    </For>
                </PaperMediaCardGroup>
            </Show>
            <MapPicturesNote pictures={props.pictures} />
        </PaperFlex>
    );
}
