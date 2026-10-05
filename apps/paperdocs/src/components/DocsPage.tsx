import {
    PaperFlex,
    PaperSeparator,
    PaperSelector,
    PaperSelectorItem,
} from "@paperboard-dev/paperui";
import "../docs/docsLayout.css";
import {
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { Sidebar } from "./Sidebar";
import { TableOfContents } from "./TableOfContents";
import { NotFound } from "./NotFound";
import {
    docComponentFor,
    isKnownSection,
    siblingsFor,
} from "../utils/routeUtils";
import { docsPath } from "../utils/base";
import { tocLevel } from "../utils/toc";
import type { TocItem } from "../types/docs";

interface DocsPageProps {
    section: string;
    pageKey: string;
}

export function DocsPage(props: DocsPageProps) {
    const known = () => isKnownSection(props.section);
    const siblings = createMemo(() =>
        siblingsFor(props.section, props.pageKey),
    );
    const valid = () => known() && siblings().current !== null;

    // Each docs page is its own document title, which the SPA shell cannot
    // set at build time.
    createEffect(() => {
        const page = siblings().current;
        document.title = page ? `${page.name} | Paperboard Docs` : "PaperDocs";
    });

    // Sorted pages → the component for the current page. Eagerly bundled, so
    // there is nothing to await and no Suspense boundary.
    const Doc = createMemo(() => {
        const page = siblings().current;
        return page ? docComponentFor(props.section, page) : null;
    });

    const [tocItems, setTocItems] = createSignal<TocItem[]>([]);
    const [activeTocId, setActiveTocId] = createSignal<string>("");

    let docContainerRef: HTMLDivElement | undefined;

    // Each navigation is a fresh document load, so scroll starts at the top
    // already; this keeps the reset intentional if the page ever gets reused.
    createEffect(() => {
        void props.pageKey;
        window.scrollTo(0, 0);
    });

    const updateToc = () => {
        if (!docContainerRef) return;
        const elements = docContainerRef.querySelectorAll("[id]");
        const items: TocItem[] = [];
        elements.forEach((el) => {
            const id = el.getAttribute("id");
            const level = tocLevel(el);
            if (id && level !== null) {
                const clone = el.cloneNode(true) as HTMLElement;
                clone.querySelector("button")?.remove();
                const text = clone.textContent?.trim() || id;
                items.push({ id, text, level });
            }
        });
        setTocItems(items);
        if (items.length > 0 && !activeTocId()) {
            setActiveTocId(items[0].id);
        }
    };

    onMount(() => {
        updateToc();

        if (docContainerRef) {
            const observer = new MutationObserver(() => {
                updateToc();
            });
            observer.observe(docContainerRef, {
                childList: true,
                subtree: true,
            });
            onCleanup(() => observer.disconnect());
        }

        const handleScroll = () => {
            const items = tocItems();
            if (items.length === 0) return;

            const scrollY =
                window.scrollY || document.documentElement.scrollTop;

            if (scrollY < 100) {
                if (activeTocId() !== items[0].id) {
                    setActiveTocId(items[0].id);
                }
                return;
            }

            const distToBottom =
                document.documentElement.scrollHeight -
                (scrollY + window.innerHeight);
            if (distToBottom < 50) {
                const lastId = items[items.length - 1].id;
                if (activeTocId() !== lastId) {
                    setActiveTocId(lastId);
                }
                return;
            }

            const targetThreshold = 90;
            let currentId = items[0].id;

            for (const item of items) {
                const el = document.getElementById(item.id);
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (rect.top <= targetThreshold + 40) {
                    currentId = item.id;
                }
            }

            if (currentId && currentId !== activeTocId()) {
                setActiveTocId(currentId);
            }
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        onCleanup(() => window.removeEventListener("scroll", handleScroll));
    });

    return (
        <Show when={valid()} fallback={<NotFound />}>
            <PaperFlex
                direction="column"
                style={{ width: "100%", flex: "1 0 auto" }}
            >
                <PaperFlex
                    direction="row"
                    fullWidth
                    justify="space-between"
                    class="docs-layout"
                    style={{ flex: "1 0 auto" }}
                >
                    <Sidebar section={props.section} pageKey={props.pageKey} />
                    <PaperFlex
                        ref={docContainerRef}
                        gap="full"
                        paddingX="quadruple"
                        paddingY="triple"
                        style={{
                            width: "100%",
                            "max-width": "1000px",
                            "min-width": "0",
                            "min-height": "calc(100vh - 45px)",
                            "box-sizing": "border-box",
                        }}
                    >
                        <Show when={Doc()}>
                            {(Component) => {
                                const Doc = Component();
                                return <Dynamic component={Doc} />;
                            }}
                        </Show>

                        <Show when={siblings().prev || siblings().next}>
                            <PaperSeparator />
                            <PaperSelector
                                horizontal
                                style={{
                                    "margin-top":
                                        "var(--paper-uigap-double)",
                                }}
                                name="switcher"
                            >
                                <Show when={siblings().prev}>
                                    <PaperSelectorItem
                                        value={`prev-${siblings().prev!.pageKey}`}
                                        icon="arrow_back"
                                        description={siblings().prev!.name}
                                        onClick={() => {
                                            window.location.href = docsPath(
                                                props.section,
                                                siblings().prev!.pageKey,
                                            );
                                        }}
                                    >
                                        Back
                                    </PaperSelectorItem>
                                </Show>
                                <Show when={siblings().next}>
                                    <PaperSelectorItem
                                        value={`next-${siblings().next!.pageKey}`}
                                        icon="arrow_forward"
                                        reverse
                                        description={siblings().next!.name}
                                        onClick={() => {
                                            window.location.href = docsPath(
                                                props.section,
                                                siblings().next!.pageKey,
                                            );
                                        }}
                                    >
                                        Next
                                    </PaperSelectorItem>
                                </Show>
                            </PaperSelector>
                        </Show>
                    </PaperFlex>
                    <TableOfContents
                        tocItems={tocItems()}
                        activeTocId={activeTocId()}
                        setActiveTocId={setActiveTocId}
                    />
                </PaperFlex>
            </PaperFlex>
        </Show>
    );
}
