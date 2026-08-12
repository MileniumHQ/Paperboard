import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
    PaperProvider,
    PaperSeparator,
    PaperSpacer,
    PaperText,
    PaperSelector,
    PaperSelectorItem,
    useContextMenuState,
} from "paperui";
import "paperui/style.css";
import index from "./docs/index.json";
import { Show, For, lazy, createSignal, onMount, onCleanup } from "solid-js";

interface Page {
    pageKey: string;
    name: string;
    file: string;
    subKey: string;
}

interface Subsection {
    key: string;
    name: string;
    icon?: string;
    pages: Page[];
}

interface SectionMeta {
    name: string;
    icon?: string;
    image?: string;
    description?: string;
}

const metaSections: Record<string, SectionMeta> =
    (index as any).meta?.sections || {};
const sectionKeys = Object.keys(metaSections);
const defaultSectionKey = sectionKeys[0] || "";

const rawPath = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => p.toLowerCase());

if (
    rawPath.length === 0 &&
    defaultSectionKey &&
    typeof window !== "undefined"
) {
    window.location.replace(`/${defaultSectionKey}`);
}

const sectionKey = rawPath.length > 0 ? rawPath[0] : defaultSectionKey;
const sectionMeta = metaSections[sectionKey];
const sectionData = (index as any)[sectionKey] || {};

const subsections: Subsection[] = Object.entries<any>(
    sectionData.subsections || {},
).map(([subKey, sub]) => {
    const rawPages = Object.entries<any>(sub.pages || {}).map(([pKey, p]) => ({
        pageKey: pKey,
        name: p.name || pKey,
        file: p.file || pKey,
        subKey,
        index: p.index ?? 0,
    }));

    const pages =
        sub.sort === "alphabetical"
            ? rawPages.sort((a, b) => a.name.localeCompare(b.name))
            : rawPages.sort((a, b) => a.index - b.index);

    return { key: subKey, name: sub.name, icon: sub.icon, pages };
});

const allPages = subsections.flatMap((s) => s.pages);

if (
    rawPath.length === 1 &&
    sectionMeta &&
    allPages.length > 0 &&
    typeof window !== "undefined"
) {
    window.location.replace(`/${sectionKey}/${allPages[0].pageKey}`);
}

const requestedPageKey = rawPath.length > 1 ? rawPath[1] : undefined;
const currentPageIndex = requestedPageKey
    ? allPages.findIndex((p) => p.pageKey === requestedPageKey)
    : -1;
const currentPage = currentPageIndex >= 0 ? allPages[currentPageIndex] : null;

const prevPage = currentPageIndex > 0 ? allPages[currentPageIndex - 1] : null;
const nextPage =
    currentPageIndex >= 0 && currentPageIndex < allPages.length - 1
        ? allPages[currentPageIndex + 1]
        : null;

const DocComponent =
    sectionMeta && currentPage
        ? lazy(
              () =>
                  import(
                      `./docs/${sectionKey}/${currentPage.subKey}/${currentPage.file}.tsx`
                  ),
          )
        : null;

const docsMenu = useContextMenuState();

export function App() {
    const [tocItems, setTocItems] = createSignal<
        { id: string; text: string; level: number }[]
    >([]);
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
    };

    let docContainerRef: HTMLDivElement | undefined;

    const updateToc = () => {
        if (!docContainerRef) return;
        const elements = docContainerRef.querySelectorAll("[id]");
        const items: { id: string; text: string; level: number }[] = [];
        elements.forEach((el) => {
            const id = el.getAttribute("id");
            if (id) {
                const clone = el.cloneNode(true) as HTMLElement;
                clone.querySelector("button")?.remove();
                const text = clone.textContent?.trim() || id;

                const classStr = el.className.toLowerCase();
                let level = 0;
                if (classStr.includes("title") || el.tagName === "H3") {
                    level = 1;
                } else if (
                    classStr.includes("subtitle") ||
                    el.tagName === "H4"
                ) {
                    level = 2;
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
        setTimeout(updateToc, 50);

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
        <>
            <PaperProvider theme={theme()} styleBody fullScreen>
                <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                    <PaperFlex
                        direction="row"
                        gap="double"
                        class="topbar"
                        align="center"
                    >
                        <PaperFlex
                            direction="row"
                            align="center"
                            gap="threefourths"
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                                window.location.href = `/${sectionKey}`;
                            }}
                        >
                            <img src={`/${sectionKey}.png`} class="logo" />
                            <PaperText rounded weight={800} size={5}>
                                {sectionMeta?.name || "Paperboard"}{" "}
                                <PaperText weight={600}>docs</PaperText>
                            </PaperText>
                        </PaperFlex>
                        <PaperFlex gap="half" direction="row">
                            <PaperButton
                                variant="text"
                                tiny
                                onClick={(e) => docsMenu.openBelow(e)}
                            >
                                Docs{" "}
                                <PaperIcon zeroHeight>expand_more</PaperIcon>
                            </PaperButton>
                            <PaperButton variant="text" tiny>
                                Learn{" "}
                                <PaperIcon zeroHeight>expand_more</PaperIcon>
                            </PaperButton>
                            <PaperButton tiny>Blog</PaperButton>
                        </PaperFlex>
                        <PaperSpacer></PaperSpacer>
                        <PaperFlex
                            direction="row"
                            align="center"
                            gap="threefourths"
                        >
                            <PaperInput
                                placeholder="Search..."
                                icon="search"
                                compact
                            ></PaperInput>
                            <PaperButton
                                icon
                                variant="text"
                                tiny
                                onClick={toggleTheme}
                            >
                                {theme() === "dark"
                                    ? "dark_mode"
                                    : "light_mode"}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                    {DocComponent ? (
                        <PaperFlex
                            direction="column"
                            style={{ width: "100%", flex: "1 0 auto" }}
                        >
                            <PaperFlex
                                direction="row"
                                fullWidth
                                justify="space-between"
                                style={{ flex: "1 0 auto" }}
                            >
                                <PaperMenu
                                    name="nav"
                                    class="sticky-sidebar"
                                    value={currentPage?.pageKey}
                                >
                                    <For each={subsections}>
                                        {(sub) => (
                                            <PaperMenuSection
                                                title={sub.name}
                                                icon={sub.icon}
                                            >
                                                <For each={sub.pages}>
                                                    {(p) => (
                                                        <PaperMenuItem
                                                            value={p.pageKey}
                                                            onClick={() => {
                                                                window.location.href = `/${sectionKey}/${p.pageKey}`;
                                                            }}
                                                        >
                                                            {p.name}
                                                        </PaperMenuItem>
                                                    )}
                                                </For>
                                            </PaperMenuSection>
                                        )}
                                    </For>
                                </PaperMenu>
                                <PaperFlex
                                    ref={docContainerRef}
                                    gap="full"
                                    paddingX="quadruple"
                                    paddingY="triple"
                                    style={{
                                        width: "100%",
                                        "max-width": "1000px",
                                        "min-height": "calc(100vh - 45px)",
                                        "box-sizing": "border-box",
                                    }}
                                >
                                    <DocComponent />

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
                                                        window.location.href = `/${sectionKey}/${prevPage!.pageKey}`;
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
                                                        window.location.href = `/${sectionKey}/${nextPage!.pageKey}`;
                                                    }}
                                                >
                                                    Next
                                                </PaperSelectorItem>
                                            </Show>
                                        </PaperSelector>
                                    </Show>
                                </PaperFlex>
                                <PaperMenu
                                    name="tableofcontents"
                                    class="sticky-sidebar"
                                    value={activeTocId()}
                                >
                                    <PaperText preset="section">
                                        Table of Contents
                                    </PaperText>
                                    <For each={tocItems()}>
                                        {(item) => (
                                            <PaperMenuItem
                                                value={item.id}
                                                level={item.level}
                                                style={{
                                                    "padding-left": `calc(12px + ${item.level * 16}px)`,
                                                }}
                                                onClick={() => {
                                                    setActiveTocId(item.id);
                                                    const el =
                                                        document.getElementById(
                                                            item.id,
                                                        );
                                                    if (el) {
                                                        el.scrollIntoView({
                                                            behavior: "smooth",
                                                        });
                                                        window.history.pushState(
                                                            null,
                                                            "",
                                                            `#${item.id}`,
                                                        );
                                                    }
                                                }}
                                            >
                                                {item.text}
                                            </PaperMenuItem>
                                        )}
                                    </For>
                                </PaperMenu>
                            </PaperFlex>

                            <footer class="docs-footer">
                                <PaperFlex
                                    direction="column"
                                    align="center"
                                    padding="double"
                                    gap="half"
                                    class="footer"
                                >
                                    <PaperFlex
                                        direction="row"
                                        justify="space-between"
                                        align="center"
                                        style={{
                                            width: "100%",
                                            padding: "var(--paper-uigap) 0",
                                        }}
                                    >
                                        <PaperFlex
                                            direction="row"
                                            align="center"
                                            gap="half"
                                        >
                                            <img
                                                src={`/${sectionKey}.png`}
                                                class="logo"
                                                style={{ width: "20px" }}
                                            />
                                            <PaperText size={2} weight={600}>
                                                {sectionMeta?.name ||
                                                    "Paperboard"}{" "}
                                                Documentation
                                            </PaperText>
                                        </PaperFlex>
                                        <PaperText size={2}>
                                            Built with PaperUI & SolidJS
                                        </PaperText>
                                    </PaperFlex>
                                </PaperFlex>
                            </footer>
                        </PaperFlex>
                    ) : (
                        <PaperFlex
                            fullHeight
                            fullWidth
                            align="center"
                            justify="center"
                            direction="column"
                            gap="threefourths"
                            style={{ "min-height": "calc(100vh - 45px)" }}
                        >
                            <PaperText weight={900} size={17}>
                                404
                            </PaperText>
                            <PaperText>
                                You've wandered far and wide, and gotten
                                nowhere.
                            </PaperText>
                            <PaperLink href="/">Go somewhere</PaperLink>
                        </PaperFlex>
                    )}
                </PaperFlex>
            </PaperProvider>
            <PaperContextMenu
                open={docsMenu.isOpen()}
                target={docsMenu.target()}
                placement={docsMenu.placement()}
                onClose={docsMenu.close}
            >
                <For each={Object.entries(metaSections)}>
                    {([key, meta]) => (
                        <PaperContextMenuItem
                            icon={
                                meta.image ? (
                                    <PaperIcon src={meta.image} />
                                ) : (
                                    <PaperIcon>
                                        {meta.icon || "description"}
                                    </PaperIcon>
                                )
                            }
                            description={meta.description}
                            onClick={() => {
                                docsMenu.close();
                                window.location.href = `/${key}`;
                            }}
                        >
                            {meta.name}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>
        </>
    );
}

export default App;
