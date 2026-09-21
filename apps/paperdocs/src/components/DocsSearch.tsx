import { PaperInput } from "@paperboard-dev/paperui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import records from "virtual:docs-search";
import { searchDocs } from "../utils/search";
import { withBase } from "../utils/base";
import styles from "./docsSearch.module.css";

const MAX_RESULTS = 12;

export function DocsSearch(props: { class?: string }) {
    const [query, setQuery] = createSignal("");
    const [open, setOpen] = createSignal(false);
    const [active, setActive] = createSignal(0);
    let wrap: HTMLDivElement | undefined;

    const results = createMemo(() =>
        query().trim() ? searchDocs(records, query()).slice(0, MAX_RESULTS) : [],
    );

    const optionId = (index: number) => `docs-search-option-${index}`;

    const handleInput = (value: string) => {
        setQuery(value);
        setActive(0);
        setOpen(value.trim().length > 0);
    };

    const move = (delta: number) => {
        const count = results().length;
        if (count === 0) return;
        setActive((current) => {
            const next = Math.min(Math.max(current + delta, 0), count - 1);
            document
                .getElementById(optionId(next))
                ?.scrollIntoView({ block: "nearest" });
            return next;
        });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (!open()) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
        } else if (e.key === "Enter") {
            const hit = results()[active()];
            if (hit) {
                e.preventDefault();
                window.location.href = withBase(`/${hit.url}`);
            }
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    onMount(() => {
        const handlePointerDown = (e: PointerEvent) => {
            const target = e.target as Node | null;
            if (wrap && target && !wrap.contains(target)) setOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        onCleanup(() =>
            document.removeEventListener("pointerdown", handlePointerDown),
        );
    });

    return (
        <div
            class={[styles.wrap, props.class].filter(Boolean).join(" ")}
            ref={wrap}
        >
            <PaperInput
                fullWidth
                compact
                icon="search"
                placeholder="Search..."
                aria-label="Search documentation"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open()}
                aria-controls="docs-search-results"
                aria-activedescendant={
                    open() && results().length > 0
                        ? optionId(active())
                        : undefined
                }
                onInput={(e) => handleInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    if (query().trim()) setOpen(true);
                }}
            />
            <Show when={open() && query().trim().length > 0}>
                <div
                    class={styles.panel}
                    id="docs-search-results"
                    role="listbox"
                    aria-label="Search results"
                >
                    <Show
                        when={results().length > 0}
                        fallback={<div class={styles.empty}>No results</div>}
                    >
                        <For each={results()}>
                            {(record, index) => (
                                <a
                                    class={styles.item}
                                    classList={{
                                        [styles.active]: index() === active(),
                                    }}
                                    id={optionId(index())}
                                    role="option"
                                    aria-selected={index() === active()}
                                    href={withBase(`/${record.url}`)}
                                    onPointerEnter={() => setActive(index())}
                                >
                                    <span class={styles.itemTitle}>
                                        {record.pageName}
                                    </span>
                                    <span class={styles.itemMeta}>
                                        {record.sectionName} /{" "}
                                        {record.subsectionName}
                                    </span>
                                </a>
                            )}
                        </For>
                    </Show>
                </div>
            </Show>
        </div>
    );
}
