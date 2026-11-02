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
import { workshopId } from "./workshop";

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
    /** a line at the card's foot, as a mod card's stat: "42.7k subscribers", "In the rotation" */
    note?: string;
}

/** Installed maps as cards, named by the mode their prefix gives. */
export const mapChoices = (spec: SourceGameSpec, names: readonly string[]): MapChoice[] => names.map((name) => ({ name, mode: mapMode(spec, name) }));

/** Why there are no pictures, where they would be: above what they would illustrate, never below a long grid. */
export function MapPicturesFailure(props: { pictures: MapPicturesState }) {
    return (
        <Show when={props.pictures.error()}>
            <PaperQuote variant="warning" icon="image" title="Map pictures unavailable">
                <PaperFlex direction="column" gap="half" align="flex-start">
                    <span>{props.pictures.error()}</span>
                    <span>Maps still work without them.</span>
                    <PaperButton onClick={() => props.pictures.retry()}>Try again</PaperButton>
                </PaperFlex>
            </PaperQuote>
        </Show>
    );
}

/** Where the pictures come from. */
export function MapPicturesCredit(props: { pictures: MapPicturesState }) {
    return (
        <Show when={props.pictures.source()}>
            {(source) => (
                <PaperText size={1} color="text-subtle">
                    Map pictures from <PaperLink href={source().url} target="_blank">{source().name}</PaperLink>.
                </PaperText>
            )}
        </Show>
    );
}

/** A map without a picture says so; it is not given another map's. */
function NoPicture() {
    return (
        <PaperFlex center fullWidth fullHeight direction="column" gap="onefourth">
            <PaperText size={10} color="text-subtle"><PaperIcon>map</PaperIcon></PaperText>
            <PaperText size={1} color="text-subtle">No picture</PaperText>
        </PaperFlex>
    );
}

/**
 * What a map is called to people: its Workshop title, or the real name the
 * game's wiki gives it ("2Fort"). `file` is the name the server knows it by
 * when that says something more; a Workshop map's id does not. A map nothing
 * names, such as one made at home, is called by its file name alone. The wiki
 * tells two maps of one name apart with their mode ("Well (Control Point)");
 * everywhere a map is shown its mode is shown beside it, so that is left off.
 */
export function mapNames(map: MapChoice, pictures: Pick<MapPicturesState, "titleOf">): { title: string; file?: string } {
    const named = map.title ?? pictures.titleOf(map.name);
    const title = named && map.mode && named.endsWith(` (${map.mode})`) ? named.slice(0, -` (${map.mode})`.length) : named;
    return title ? { title, file: workshopId(map.name) ? undefined : map.name } : { title: map.name };
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
    /** only the cards: no search, mode filter or credit line, for a list that is already what was asked for */
    bare?: boolean;
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
            const text = `${map.name} ${mapNames(map, props.pictures).title} ${map.mode ?? ""}`.toLowerCase();
            return words.every((word) => text.includes(word));
        });
    });

    return (
        <PaperFlex direction="column" gap="half">
            <Show when={!props.bare}>
            <MapPicturesFailure pictures={props.pictures} />
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
            </Show>
            <Show
                when={shown().length > 0}
                fallback={<PaperEmptyState icon="search" title="No maps match">Try another name or mode.</PaperEmptyState>}
            >
                <PaperMediaCardGroup minCardWidth="field">
                    <For each={shown()}>
                        {(map) => {
                            const names = () => mapNames(map, props.pictures);
                            return (
                                <PaperMediaCard
                                    banner={map.picture ?? props.pictures.of(map.name) ?? <NoPicture />}
                                    bannerAlt={names().title}
                                    title={breakable(names().title)}
                                    subtitle={names().file ? breakable(names().file!) : undefined}
                                    description={props.hideMode ? undefined : map.mode}
                                    footerLeft={map.note ? <PaperText size={2} color="text-subtle">{map.note}</PaperText> : undefined}
                                    selected={props.value === map.name}
                                    disabled={props.disabled}
                                    onClick={() => props.onPick(map.name)}
                                />
                            );
                        }}
                    </For>
                </PaperMediaCardGroup>
            </Show>
            <Show when={!props.bare}>
                <MapPicturesCredit pictures={props.pictures} />
            </Show>
        </PaperFlex>
    );
}
