// The Library beside the canvas, as the Actions panel has it: a rail of
// categories (the built-ins, then each panel by its icon), and over the
// block list a header with the category, how many blocks it has, a search,
// and for a panel with projects, which one. The list itself is Blockly's
// flyout (libraryFlyout.ts), drawn under this header.
import { For, Show } from "solid-js";
import { PaperBadge, PaperButton, PaperFlex, PaperIcon, PaperInput, PaperRail, PaperRailItem, PaperSelectMenu, PaperSelectMenuItem, PaperSeparator, PaperText } from "@mileniumhq/paperui";
import styles from "./Library.module.css";

export interface LibraryCategory {
    /** "builtin:<name>" or "panel:<id>" */
    id: string;
    name: string;
    /** a Material Symbols name, or the panel's icon */
    icon?: string;
    iconUrl?: string;
}

export interface LibraryProject {
    id: string;
    name: string;
    icon?: string;
}

export interface LibraryProps {
    builtins: LibraryCategory[];
    panels: LibraryCategory[];
    selected: string;
    onSelect(id: string): void;
    search: string;
    onSearch(text: string): void;
    /** how many blocks the list shows */
    count: number;
    projects: LibraryProject[];
    project: string | null;
    onProject(id: string): void;
    sections: string[];
    onJump(section: string): void;
    onCollapse(): void;
    /** shown for the Variables category: makes a new variable */
    onCreateVariable?: () => void;
    headerRef(el: HTMLDivElement): void;
}

export function LibraryRail(props: Pick<LibraryProps, "builtins" | "panels" | "selected" | "onSelect">) {
    return (
        <div class={styles.rail}>
            <PaperRail name="library-category" value={props.selected} onValueChange={(value) => props.onSelect(String(value))} showLabels>
                <For each={props.builtins}>{(category) => <PaperRailItem value={category.id} icon={category.icon ?? "extension"} label={category.name} showLabel />}</For>
                <Show when={props.panels.length > 0}>
                    <PaperSeparator direction="horizontal" class={styles.railSeparator} />
                    <For each={props.panels}>
                        {(category) => (
                            <PaperRailItem
                                value={category.id}
                                icon={category.iconUrl ? <PaperIcon src={category.iconUrl} /> : (category.icon ?? "extension")}
                                label={category.name}
                                showLabel
                            />
                        )}
                    </For>
                </Show>
            </PaperRail>
        </div>
    );
}

export function LibraryHeader(props: Omit<LibraryProps, "builtins" | "panels" | "onSelect"> & { category: LibraryCategory | undefined }) {
    return (
        <div class={styles.header} ref={props.headerRef}>
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperFlex direction="row" align="center" justify="space-between" fullWidth>
                    <PaperFlex direction="row" align="center" gap="half">
                        <Show
                            when={!props.search}
                            fallback={
                                <>
                                    <PaperIcon>search</PaperIcon>
                                    <PaperText preset="heading">Search</PaperText>
                                </>
                            }
                        >
                            <Show when={props.category?.iconUrl} fallback={<PaperIcon>{props.category?.icon ?? "extension"}</PaperIcon>}>
                                <PaperIcon src={props.category!.iconUrl} />
                            </Show>
                            <PaperText preset="heading">{props.category?.name}</PaperText>
                        </Show>
                        <PaperBadge variant="monochrome">{props.count}</PaperBadge>
                    </PaperFlex>
                    <PaperButton size="tiny" icon onClick={() => props.onCollapse()} title="Collapse Library">
                        <PaperIcon>chevron_left</PaperIcon>
                    </PaperButton>
                </PaperFlex>
                <PaperInput fullWidth icon="search" placeholder="Search blocks..." value={props.search} onInput={(e) => props.onSearch(e.currentTarget.value)} />
                <Show when={!props.search && props.onCreateVariable}>
                    {(create) => (
                        <PaperButton fullWidth onClick={() => create()()}>
                            <PaperIcon>add</PaperIcon>
                            Create variable
                        </PaperButton>
                    )}
                </Show>
                <Show when={!props.search && props.project}>
                    {(project) => (
                        <PaperSelectMenu name="libraryProject" fullWidth value={project()} aria-label="Project" onValueChange={(value) => props.onProject(String(value))}>
                            <For each={props.projects}>
                                {(item) => (
                                    <PaperSelectMenuItem value={item.id} icon={item.icon ?? "folder"}>
                                        {item.name}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                    )}
                </Show>
                <Show when={!props.search && props.sections.length > 1}>
                    <PaperSelectMenu name="librarySectionJump" fullWidth value="" placeholder="Jump to a section..." onValueChange={(value) => props.onJump(String(value))}>
                        <For each={props.sections}>{(section) => <PaperSelectMenuItem value={section}>{section}</PaperSelectMenuItem>}</For>
                    </PaperSelectMenu>
                </Show>
            </PaperFlex>
        </div>
    );
}
