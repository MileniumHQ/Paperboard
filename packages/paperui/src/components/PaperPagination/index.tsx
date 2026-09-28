import styles from "./index.module.css";
import { createMemo, For, Show, splitProps, type JSX } from "solid-js";
import { PaperButton } from "../PaperButton";

export interface PaperPaginationProps
    extends Omit<JSX.HTMLAttributes<HTMLElement>, "onChange"> {
    /** Current page, 1-based. */
    page: number;
    /** Total number of pages; 1 or less renders nothing. */
    pageCount: number;
    onPageChange?: (page: number) => void;
    disabled?: boolean;
    /** Accessible name for the navigation landmark. */
    label?: string;
    /** Page buttons kept on each side of the current page. Default 1. */
    siblings?: number;
}

type PageToken = number | "gap-start" | "gap-end";

/**
 * Compact page navigation: first and last page are always reachable, a
 * window of pages follows the current one, and skipped runs collapse into an
 * ellipsis.
 */
export function PaperPagination(props: PaperPaginationProps) {
    const [local, rest] = splitProps(props, [
        "page",
        "pageCount",
        "onPageChange",
        "disabled",
        "label",
        "siblings",
        "class",
        "classList",
    ]);

    const pageCount = () => Math.max(0, Math.floor(local.pageCount));
    const current = () => Math.min(Math.max(1, Math.round(local.page || 1)), pageCount());

    const tokens = createMemo<PageToken[]>(() => {
        const count = pageCount();
        const here = current();
        const siblings = Math.max(0, local.siblings ?? 1);
        const from = Math.max(2, here - siblings);
        const to = Math.min(count - 1, here + siblings);
        const list: PageToken[] = [1];
        if (from > 2) list.push("gap-start");
        for (let page = from; page <= to; page += 1) list.push(page);
        if (to < count - 1) list.push("gap-end");
        if (count > 1) list.push(count);
        return list;
    });

    const go = (page: number) => {
        if (local.disabled || page < 1 || page > pageCount() || page === current()) return;
        local.onPageChange?.(page);
    };

    return (
        <Show when={pageCount() > 1}>
            <nav
                {...rest}
                class={[styles.PaperPagination, local.class].filter(Boolean).join(" ")}
                classList={local.classList}
                aria-label={local.label ?? "Pagination"}
            >
                <PaperButton
                    icon
                    size="small"
                    variant="text"
                    aria-label="Previous page"
                    disabled={local.disabled || current() <= 1}
                    onClick={() => go(current() - 1)}
                >
                    chevron_left
                </PaperButton>

                <For each={tokens()}>
                    {(token) => (
                        <Show
                            when={typeof token === "number"}
                            fallback={<span class={styles.gap} aria-hidden="true">…</span>}
                        >
                            <PaperButton
                                size="small"
                                variant={token === current() ? "primary" : "text"}
                                aria-label={`Page ${token}`}
                                aria-current={token === current() ? "page" : undefined}
                                disabled={local.disabled}
                                onClick={() => go(token as number)}
                            >
                                {token}
                            </PaperButton>
                        </Show>
                    )}
                </For>

                <PaperButton
                    icon
                    size="small"
                    variant="text"
                    aria-label="Next page"
                    disabled={local.disabled || current() >= pageCount()}
                    onClick={() => go(current() + 1)}
                >
                    chevron_right
                </PaperButton>
            </nav>
        </Show>
    );
}
