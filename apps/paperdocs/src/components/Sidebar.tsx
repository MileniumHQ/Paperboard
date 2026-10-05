import {
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
} from "@paperboard-dev/paperui";
import { For, Show } from "solid-js";
import { subsectionsFor } from "../utils/routeUtils";
import { docsPath } from "../utils/base";

interface SidebarProps {
    section: string;
    pageKey: string;
}

export function Sidebar(props: SidebarProps) {
    return (
        <Show when={props.section}>
            <PaperMenu
                name="nav"
                class="sticky-sidebar docs-sidebar"
                value={props.pageKey}
            >
                <For each={subsectionsFor(props.section)}>
                    {(sub) => (
                        <PaperMenuSection title={sub.name} icon={sub.icon}>
                            <For each={sub.pages}>
                                {(p) => (
                                    <PaperMenuItem
                                        value={p.pageKey}
                                        onClick={() => {
                                            window.location.href = docsPath(
                                                props.section,
                                                p.pageKey,
                                            );
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
        </Show>
    );
}
