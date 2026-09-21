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
import { metaSections } from "../utils/routeUtils";
import { withBase } from "../utils/base";
import { DocsSearch } from "./DocsSearch";

interface TopbarProps {
    theme: "dark" | "light";
    toggleTheme: () => void;
    section?: string;
}

// Product pages, mirroring the static landing's Learn dropdown
// (public/index.html). Site-root hrefs, so full navigations — not router
// routes (they live outside the /docs base).
const LEARN_LINKS = [
    { label: "Actions", href: "/actions", image: "/pictures/blocks.png" },
    { label: "Game Server", href: "/game-server", image: "/pictures/game-server.png" },
    { label: "Bot Creator", href: "/bot-creator", image: "/pictures/discord-bot.png" },
    { label: "Local AI", href: "/ai", image: "/pictures/ai.png" },
];

export function Topbar(props: TopbarProps) {
    const docsMenu = useContextMenuState();
    const learnMenu = useContextMenuState();

    const sectionMeta = () =>
        props.section ? metaSections[props.section] : undefined;

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
                    href={withBase(sectionMeta() ? `/${props.section}` : "/")}
                >
                    <img
                        src={withBase(
                            `/${sectionMeta() ? props.section : "paperdocs"}.png`,
                        )}
                        class="logo"
                    />
                    <PaperText rounded weight={800} size={5}>
                        {sectionMeta()?.name || "PaperDocs"}{" "}
                        <Show when={sectionMeta()}>
                            <PaperText weight={600}>docs</PaperText>
                        </Show>
                    </PaperText>
                </a>
                <PaperFlex gap="half" direction="row" class="topbar-links">
                    <PaperButton
                        variant="text"
                        size="tiny"
                        onClick={(e) => learnMenu.openBelow(e)}
                    >
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
                open={learnMenu.isOpen()}
                target={learnMenu.target()}
                placement={learnMenu.placement()}
                onClose={learnMenu.close}
            >
                <For each={LEARN_LINKS}>
                    {(link) => (
                        <PaperContextMenuItem
                            icon={<PaperIcon src={withBase(link.image)} />}
                            onClick={() => {
                                learnMenu.close();
                                window.location.href = link.href;
                            }}
                        >
                            {link.label}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>

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
