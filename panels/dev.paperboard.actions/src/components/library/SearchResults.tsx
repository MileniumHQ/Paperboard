// A Library search: every match, grouped under the category it came from.
import { For, Show } from "solid-js";
import { PaperBadge, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { SearchGroup } from "../../lib/libraryCategories";
import LibraryItem, { type LibraryPress } from "./LibraryItem";

export default function SearchResults(props: { search: string; groups: SearchGroup[]; onPress: LibraryPress }) {
    return (
        <>
            <Show when={props.groups.length === 0}>
                <div class="library-empty">
                    <PaperIcon>search_off</PaperIcon>
                    <PaperText preset="body">
                        No actions matching "{props.search}"
                    </PaperText>
                </div>
            </Show>

            <For each={props.groups}>
                {(group) => (
                    <div class="library-search-group">
                        <div class="library-section-header">
                            <Show when={group.categoryIconUrl}>
                                <PaperIcon src={group.categoryIconUrl} />
                            </Show>
                            <Show when={!group.categoryIconUrl}>
                                <PaperIcon>{group.categoryIcon}</PaperIcon>
                            </Show>
                            <PaperText size={2} weight={700}>
                                {group.categoryName}
                            </PaperText>
                            <PaperBadge variant="monochrome">
                                {group.items.length}
                            </PaperBadge>
                        </div>

                        <For each={group.items}>
                            {(item) => (
                                <LibraryItem
                                    item={item.data}
                                    isTrigger={item.isTrigger}
                                    iconUrl={item.iconUrl}
                                    onPress={props.onPress}
                                />
                            )}
                        </For>
                    </div>
                )}
            </For>
        </>
    );
}
