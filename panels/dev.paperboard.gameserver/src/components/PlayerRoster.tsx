import { createMemo, createSignal, For, Index, Show, type JSX } from "solid-js";
import {
    PaperCard,
    PaperChip,
    PaperFlex,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperListLabel,
    PaperSplit,
    PaperSwatch,
    PaperText,
    type PaperColor,
} from "@mileniumhq/paperui";

export interface RosterFilter {
    label: string;
    count: number;
    selected: boolean;
    onToggle(): void;
}

/** One list section. Keep player objects stable between updates so rows aren't rebuilt. */
export interface RosterSection<T> {
    label: string;
    players: readonly T[];
}

export function statusColor(online: boolean, banned: boolean): PaperColor {
    if (banned) return "danger";
    return online ? "success" : "border-emphasis";
}

/**
 * A game's players: a searchable, filterable list beside the open player's
 * detail. Each game supplies its rows, filters and detail.
 */
export default function PlayerRoster<T extends { name: string }>(props: {
    search: string;
    /** every player before the search and filters: an empty list says whether they left nobody, or nobody has joined */
    total: number;
    onSearch(query: string): void;
    filters: readonly RosterFilter[];
    sections: readonly RosterSection<T>[];
    icon(player: T): JSX.Element;
    description(player: T): string;
    badges?(player: T): JSX.Element;
    status(player: T): PaperColor;
    open?: string;
    onOpen(name: string | undefined): void;
    children: JSX.Element;
}) {
    // Collapsed, PaperSplit slides the detail in over the roster as a page (a
    // modal takes no back swipe). The page opens from a row and closes with
    // its back action, and the open player stays set while it slides out so
    // the page doesn't change under the animation; rows open the detail
    // directly, because the roster's radio selection is invisible behind it.
    const [compact, setCompact] = createSignal(false);
    const [detailOpen, setDetailOpen] = createSignal(false);
    const any = () => props.sections.some((section) => section.players.length > 0);
    // Another player's detail is a new view, built again: it opens at its top,
    // not scrolled to where the last player's was left. The same player's
    // stays the view it is while their data changes, so a switch pressed on
    // it slides where it is and the page keeps its scroll.
    const openName = createMemo(() => props.open);
    const opened = createMemo(() => ({ name: openName() }));

    return (
        <PaperFlex grow minHeight={0} fullWidth>
            <PaperSplit
                detailActive={detailOpen() && props.open !== undefined}
                detailTitle={props.open ?? ""}
                onDetailClose={() => setDetailOpen(false)}
                onCollapsedChange={setCompact}
                side={
                    <PaperFlex direction="column" gap="half" fullHeight>
                        <PaperFlex direction="column" gap="half" shrink={false}>
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder="Player"
                                value={props.search}
                                onInput={(e) => props.onSearch(e.currentTarget.value)}
                            />
                            <PaperFlex direction="row" gap="half" wrap>
                                {/* by position: the filters are a fresh list on every update, and each chip stays */}
                                <Index each={props.filters}>
                                    {(filter) => (
                                        <PaperChip selected={filter().selected} count={filter().count} onClick={() => filter().onToggle()}>
                                            {filter().label}
                                        </PaperChip>
                                    )}
                                </Index>
                            </PaperFlex>
                        </PaperFlex>
                        <PaperCard flex={any() || undefined} minHeight={0} fullWidth>
                            <Show
                                when={any()}
                                fallback={
                                    <PaperFlex padding="full" center>
                                        <PaperText size={3}>{props.total > 0 ? "No players match these filters." : "No players yet. Players who join show up here."}</PaperText>
                                    </PaperFlex>
                                }
                            >
                                <PaperList
                                    name="playersList"
                                    value={compact() ? undefined : props.open}
                                    onValueChange={(val) => props.onOpen(String(val))}
                                    fullWidth
                                    flex={1}
                                    scrollable
                                >
                                    <Index each={props.sections}>
                                        {(section) => (
                                            <Show when={section().players.length > 0}>
                                                <PaperListLabel as="h3">{section().label} ({section().players.length})</PaperListLabel>
                                                <For each={section().players}>
                                                    {(player) => (
                                                        <PaperListItem
                                                            value={player.name}
                                                            onClick={(e) => {
                                                                // compact: the roster sits behind the detail modal and its
                                                                // selection cannot be seen or re-triggered, so suppress the
                                                                // hidden radio — a re-click then opens instead of toggling a
                                                                // selection nobody can see.
                                                                if (compact()) e.preventDefault();
                                                                props.onOpen(player.name);
                                                                setDetailOpen(true);
                                                            }}
                                                            icon={props.icon(player)}
                                                            description={
                                                                // one line, so a row with every badge stands as tall as the rest
                                                                <PaperText as="div" truncate size={1} weight={600}>
                                                                    {props.description(player)}
                                                                </PaperText>
                                                            }
                                                            actions={
                                                                <PaperFlex direction="row" gap="onefourth" align="center">
                                                                    {props.badges?.(player)}
                                                                    <PaperSwatch color={props.status(player)} size="small" />
                                                                </PaperFlex>
                                                            }
                                                        >
                                                            {player.name}
                                                        </PaperListItem>
                                                    )}
                                                </For>
                                            </Show>
                                        )}
                                    </Index>
                                </PaperList>
                            </Show>
                        </PaperCard>
                    </PaperFlex>
                }
            >
                {/* the detail brings its own margin and scroll */}
                <PaperFlex direction="column" flex={1} minHeight={0} fullHeight>
                    <Show when={opened()} keyed>
                        {(_opened) => props.children}
                    </Show>
                </PaperFlex>
            </PaperSplit>
        </PaperFlex>
    );
}
