import {
    PaperFlex,
    PaperProvider,
    PaperSelector,
    PaperSelectorItem,
    PaperSeparator,
} from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Footer } from "./components/Footer";
import { NotFound } from "./components/NotFound";
import { Sidebar } from "./components/Sidebar";
import { TableOfContents } from "./components/TableOfContents";
import { Topbar } from "./components/Topbar";
import type { TocItem } from "./types/docs";
import { Landing } from "./components/Landing";
import {
    DocComponent,
    nextPage,
    prevPage,
    sectionKey,
} from "./utils/routeUtils";
import { withBase } from "./utils/base";

export function App() {
    const [tocItems, setTocItems] = createSignal<TocItem[]>([]);
    const [activeTocId, setActiveTocId] = createSignal<string>("");
    const [theme, setTheme] = createSignal<"dark" | "light">(
        (typeof localStorage !== "undefined" &&
            (localStorage.getItem("paper-docs-theme") as "dark" | "light")) ||
            "dark",
    );

    const toggleTheme = () => {
        const next = theme() === "dark" ? "light" : "dark";
        setTheme(next);
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("paper-docs-theme", next);
        }
        // Update the document root alongside the provider so the canvas and
        // scrollbars swap in the same frame, with no flash between them.
        if (typeof document !== "undefined") {
            document.documentElement.setAttribute(
                "data-paperui-theme",
                next,
            );
            document.documentElement.style.colorScheme = next;
        }
    };

    let docContainerRef: HTMLDivElement | undefined;

    const updateToc = () => {
        if (!docContainerRef) return;
        const elements = docContainerRef.querySelectorAll("[id]");
        const items: TocItem[] = [];
        elements.forEach((el) => {
            const id = el.getAttribute("id");
            if (id) {
                const clone = el.cloneNode(true) as HTMLElement;
                clone.querySelector("button")?.remove();
                const text = clone.textContent?.trim() || id;

                const preset = el.getAttribute("data-preset") || "";
                const classStr = el.className.toLowerCase();
                const tagName = el.tagName.toUpperCase();

                let level = 0;
                if (
                    preset === "title" ||
                    classStr.includes("title") ||
                    tagName === "H3"
                ) {
                    level = 1;
                } else if (
                    preset === "subtitle" ||
                    classStr.includes("subtitle") ||
                    tagName === "H4"
                ) {
                    level = 2;
                } else if (
                    preset === "subheader" ||
                    classStr.includes("subheader") ||
                    tagName === "H2"
                ) {
                    level = 0;
                }

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
        <PaperProvider theme={theme()} styleBody>
            <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                <Topbar theme={theme()} toggleTheme={toggleTheme} />
                <Show when={sectionKey == "/"}>
                    <Landing></Landing>
                </Show>
                <Show when={DocComponent}>
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
                            <Sidebar />
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
                                <Show when={DocComponent}>
                                    {(Doc) => {
                                        const Component = Doc();
                                        return <Component />;
                                    }}
                                </Show>

                                <Show when={prevPage || nextPage}>
                                    <PaperSeparator />
                                    <PaperSelector
                                        horizontal
                                        style={{
                                            "margin-top":
                                                "var(--paper-uigap-double)",
                                        }}
                                        name="switcher"
                                    >
                                        <Show when={prevPage}>
                                            <PaperSelectorItem
                                                value={`prev-${prevPage!.pageKey}`}
                                                icon="arrow_back"
                                                description={prevPage!.name}
                                                onClick={() => {
                                                    window.location.href = withBase(
                                                        `/${sectionKey}/${prevPage!.pageKey}`,
                                                    );
                                                }}
                                            >
                                                Back
                                            </PaperSelectorItem>
                                        </Show>
                                        <Show when={nextPage}>
                                            <PaperSelectorItem
                                                value={`next-${nextPage!.pageKey}`}
                                                icon="arrow_forward"
                                                reverse
                                                description={nextPage!.name}
                                                onClick={() => {
                                                    window.location.href = withBase(
                                                        `/${sectionKey}/${nextPage!.pageKey}`,
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
                <Show when={!DocComponent && sectionKey != "/"}>
                    <NotFound />
                </Show>
                <Footer />
            </PaperFlex>
        </PaperProvider>
    );
}

export default App;
