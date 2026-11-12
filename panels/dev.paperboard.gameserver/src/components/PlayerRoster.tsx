import { createSignal, For, Index, Show, type JSX } from "solid-js";
import {
    PaperChip,
    PaperFlex,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperListLabel,
    PaperQuote,
    PaperSlidePage,
    PaperSplit,
    PaperSwatch,
    PaperText,
    type PaperColor,
} from "@mileniumhq/paperui";
import type { Outcome } from "../lib/failure";

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
    onSearch(query: string): void;
    filters: readonly RosterFilter[];
    /** the last thing that went wrong with the roster, quoted above the list */
    feedback?: Outcome;
    onDismissFeedback?(): void;
    sections: readonly RosterSection<T>[];
    icon(player: T): JSX.Element;
    description(player: T): string;
    badges?(player: T): JSX.Element;
    status(player: T): PaperColor;
    open?: string;
    onOpen(name: string | undefined): void;
    children: JSX.Element;
}) {
    // Collapsed, the detail is a page that slides in over the roster (a modal
    // takes no back swipe). The page opens from a row and closes with its back
    // action, and the open player stays set while it slides out so the page
    // doesn't change under the animation; rows open the detail directly,
    // because the roster's radio selection is invisible behind it.
    const [compact, setCompact] = createSignal(false);
    const [detailOpen, setDetailOpen] = createSignal(false);
    const any = () => props.sections.some((section) => section.players.length > 0);
    // Another player's detail is a new view, built again: it opens at its top,
    // not scrolled to where the last player's was left.
    const detail = () => {
        void props.open;
        return props.children;
    };

    return (
        <PaperFlex grow minHeight={0} fullWidth>
            <PaperSplit
                detailActive={false}
                onCollapsedChange={setCompact}
                side={
                    <PaperFlex direction="column" gap="half" fullHeight>
                        <PaperFlex direction="column" gap="half" shrink={false}>
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder="Search players"
                                value={props.search}
                                onInput={(e) => props.onSearch(e.currentTarget.value)}
                            />
                            <PaperFlex direction="row" gap="half" wrap>
                                <For each={props.filters}>
                                    {(filter) => (
                                        <PaperChip selected={filter.selected} count={filter.count} onClick={() => filter.onToggle()}>
                                            {filter.label}
                                        </PaperChip>
                                    )}
                                </For>
                            </PaperFlex>
                            <Show when={props.feedback}>
                                {(note) => (
                                    <PaperQuote variant="danger" icon="warning" title={note().title} onDismiss={props.onDismissFeedback}>
                                        {note().message}
                                    </PaperQuote>
                                )}
                            </Show>
                        </PaperFlex>
                        <Show
                            when={any()}
                            fallback={
                                <PaperFlex padding="full" center>
                                    <PaperText size={3}>No players match these filters.</PaperText>
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
                                                        description={props.description(player)}
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
                    </PaperFlex>
                }
            >
                <Show when={!compact()}>{detail()}</Show>
            </PaperSplit>
            {/* over the whole panel, its own bar in place of the tab's */}
            <PaperSlidePage
                position="fixed"
                enabled={compact()}
                open={detailOpen() && props.open !== undefined}
                title={props.open ?? ""}
                onBack={() => setDetailOpen(false)}
            >
                <Show when={compact()}>
                    {/* the detail brings its own margin and scroll */}
                    <PaperFlex direction="column" flex={1} minHeight={0}>
                        {detail()}
                    </PaperFlex>
                </Show>
            </PaperSlidePage>
        </PaperFlex>
    );
}
