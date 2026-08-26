import { PaperMenu, PaperMenuItem, PaperMenuSection } from "@paperboard-dev/paperui";
import { For } from "solid-js";
import { currentPage, sectionKey, subsections } from "../utils/routeUtils";

export function Sidebar() {
    return (
        <PaperMenu
            name="nav"
            class="sticky-sidebar"
            value={currentPage?.pageKey}
        >
            <For each={subsections}>
                {(sub) => (
                    <PaperMenuSection title={sub.name} icon={sub.icon}>
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
    );
}
