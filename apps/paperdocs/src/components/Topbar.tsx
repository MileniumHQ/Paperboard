import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperSpacer,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";
import { For, Show } from "solid-js";
import { metaSections, sectionKey, sectionMeta } from "../utils/routeUtils";

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
                <PaperFlex
                    direction="row"
                    align="center"
                    gap="threefourths"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                        window.location.href = `/${sectionKey}`;
                    }}
                >
                    <img
                        src={`/${sectionKey != "/" ? sectionKey : "paperdocs"}.png`}
                        class="logo"
                    />
                    <PaperText rounded weight={800} size={5}>
                        {sectionMeta?.name || "PaperDocs"}{" "}
                        <Show when={sectionKey != "/"}>
                            <PaperText weight={600}>docs</PaperText>
                        </Show>
                    </PaperText>
                </PaperFlex>
                <PaperFlex gap="half" direction="row">
                    <PaperButton
                        variant="text"
                        tiny
                        onClick={(e) => docsMenu.openBelow(e)}
                    >
                        Docs <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton variant="text" tiny>
                        Learn <PaperIcon zeroHeight>expand_more</PaperIcon>
                    </PaperButton>
                    <PaperButton tiny>Blog</PaperButton>
                </PaperFlex>
                <PaperSpacer></PaperSpacer>
                <PaperFlex direction="row" align="center" gap="threefourths">
                    <PaperInput
                        placeholder="Search..."
                        icon="search"
                        compact
                    ></PaperInput>
                    <PaperButton
                        icon
                        variant="text"
                        tiny
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
