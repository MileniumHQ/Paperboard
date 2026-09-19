import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperIcon,
    PaperSpacer,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";
import { For, Show } from "solid-js";
import { metaSections, sectionKey, sectionMeta } from "../utils/routeUtils";
import { withBase } from "../utils/base";
import { DocsSearch } from "./DocsSearch";

interface TopbarProps {
    theme: "dark" | "light";
    toggleTheme: () => void;
}

export function Topbar(props: TopbarProps) {
    const docsMenu = useContextMenuState();

    return (
        <>
            <PaperFlex
                direction="row"
                gap="double"
                class="topbar"
                align="center"
            >
                <a
                    class="topbar-brand"
                    href={withBase(sectionKey === "/" ? "/" : `/${sectionKey}`)}
                >
                    <img
                        src={withBase(
                            `/${sectionKey != "/" ? sectionKey : "paperdocs"}.png`,
                        )}
                        class="logo"
                    />
                    <PaperText rounded weight={800} size={5}>
                        {sectionMeta?.name || "PaperDocs"}{" "}
                        <Show when={sectionKey != "/"}>
                            <PaperText weight={600}>docs</PaperText>
                        </Show>
                    </PaperText>
                </a>
                <PaperFlex gap="half" direction="row" class="topbar-links">
                    <PaperButton variant="text" size="tiny">
                        Learn <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton
                        variant="text"
                        size="tiny"
                        onClick={(e) => docsMenu.openBelow(e)}
                    >
                        Docs <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton variant="text" size="tiny" href="/blog">
                        Blog
                    </PaperButton>
                </PaperFlex>
                <PaperSpacer></PaperSpacer>
                <PaperFlex
                    direction="row"
                    align="center"
                    gap="threefourths"
                    class="topbar-actions"
                >
                    <DocsSearch class="topbar-search" />
                    <PaperButton
                        icon
                        variant="text"
                        size="tiny"
                        onClick={props.toggleTheme}
                    >
                        {props.theme === "dark" ? "dark_mode" : "light_mode"}
                    </PaperButton>
                </PaperFlex>
            </PaperFlex>

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
                                    <PaperIcon src={withBase(meta.image)} />
                                ) : (
                                    <PaperIcon>
                                        {meta.icon || "description"}
                                    </PaperIcon>
                                )
                            }
                            description={meta.description}
                            onClick={() => {
                                docsMenu.close();
                                window.location.href = withBase(`/${key}`);
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
