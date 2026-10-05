import { PaperMenu, PaperMenuItem, PaperText } from "@mileniumhq/paperui";
import { For } from "solid-js";
import type { TocItem } from "../types/docs";

interface TableOfContentsProps {
    tocItems: TocItem[];
    activeTocId: string;
    setActiveTocId: (id: string) => void;
}

export function TableOfContents(props: TableOfContentsProps) {
    return (
        <PaperMenu
            name="tableofcontents"
            class="sticky-sidebar docs-toc"
            value={props.activeTocId}
        >
            <PaperText preset="section">Table of Contents</PaperText>
            <For each={props.tocItems}>
                {(item) => (
                    <PaperMenuItem
                        value={item.id}
                        level={item.level}
                        style={{
                            "padding-left": `calc(12px + ${item.level * 16}px)`,
                        }}
                        onClick={() => {
                            props.setActiveTocId(item.id);
                            const el = document.getElementById(item.id);
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
    );
}
