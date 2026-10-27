// The blocks of the chosen Library category: a panel's, in its sections,
// or a builtin category's list.
import { For, Show } from "solid-js";
import { PaperBadge, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { Category } from "../../lib/libraryCategories";
import { isBuiltinTrigger } from "../../lib/libraryCategories";
import LibraryItem, { type LibraryPress } from "./LibraryItem";

export default function CategoryItems(props: { category: Category | undefined; onPress: LibraryPress }) {
    const panel = () => (props.category?.domain === "panel" ? props.category : undefined);
    const builtin = () => (props.category && props.category.domain !== "panel" ? props.category : undefined);

    return (
        <>
            <Show when={panel()}>
                {(category) => (
                    <For each={category().sections}>
                        {(section) => (
                            <div
                                class="library-category-section"
                                data-library-section={section.id}
                            >
                                <div class="library-section-header library-category-header">
                                    <PaperIcon>
                                        {section.icon || "category"}
                                    </PaperIcon>
                                    <PaperText size={2} weight={700}>
                                        {section.name}
                                    </PaperText>
                                    <PaperBadge variant="monochrome">
                                        {section.triggers.length + section.actions.length}
                                    </PaperBadge>
                                </div>

                                <For each={section.triggers}>
                                    {(trig) => (
                                        <LibraryItem item={trig} isTrigger={true} iconUrl={category().iconUrl} onPress={props.onPress} />
                                    )}
                                </For>

                                <For each={section.actions}>
                                    {(act) => (
                                        <LibraryItem item={act} isTrigger={false} iconUrl={category().iconUrl} onPress={props.onPress} />
                                    )}
                                </For>
                            </div>
                        )}
                    </For>
                )}
            </Show>

            <Show when={builtin()}>
                {(category) => (
                    <>
                        <Show when={category().items.length === 0}>
                            <div class="library-empty">
                                <PaperIcon>extension_off</PaperIcon>
                                <PaperText preset="body">
                                    No actions in this category
                                </PaperText>
                            </div>
                        </Show>

                        <For each={category().items}>
                            {(act) => <LibraryItem item={act} isTrigger={isBuiltinTrigger(act)} onPress={props.onPress} />}
                        </For>
                    </>
                )}
            </Show>
        </>
    );
}
