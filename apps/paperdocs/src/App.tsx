import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperEffect,
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
    useContextMenuState,
} from "paperui";
import "paperui/style.css";
import index from "./docs/index.json";
import { Show } from "solid-js";

const validSections = {
    paperboard: "Paperboard",
    paperui: "PaperUI",
    paperapi: "PaperAPI",
};
const pathname = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => p.toLowerCase());

const section = Object.keys(validSections).includes(pathname[0])
    ? pathname[0]
    : null;
const page = index[section][pathname[1]] ? index[section][pathname[1]] : null;
const pageid = index[section][pathname[1]] ? pathname[1] : null;
const sectionName = validSections[section];
console.log(page, pageid, sectionName, section, pathname, index);

const docImport =
    section && page
        ? await import(
              `./docs/${section}/${page.index.toString().padStart(2, "0")}-${pageid}`
          )
        : null;
const DocComponent = docImport ? docImport.default : null;

const docsMenu = useContextMenuState();
export function App() {
    return (
        <>
            <PaperProvider theme="dark" fullScreen>
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
                    >
                        <img src={`/${section}.png`} class="logo" />
                        <PaperText rounded weight={800} size={5}>
                            {sectionName}{" "}
                            <PaperText weight={600}>docs</PaperText>
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
                        <PaperButton icon variant="text" tiny>
                            dark_mode
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
                {DocComponent ? (
                    <>
                        <PaperFlex
                            direction="row"
                            fullHeight
                            fullWidth
                            justify="space-between"
                        >
                            <PaperMenu name="nav">
                                <PaperMenuSection
                                    title="Getting started"
                                    icon="rocket_launch"
                                >
                                    <PaperMenuItem value="introduction">
                                        Introduction
                                    </PaperMenuItem>
                                    <PaperMenuItem value="quick-start">
                                        Quick start
                                    </PaperMenuItem>
                                </PaperMenuSection>
                            </PaperMenu>
                            <PaperFlex
                                gap="full"
                                paddingX="quadruple"
                                paddingY="triple"
                                fullHeight
                                style={{
                                    width: "100%",
                                    "max-width": "1000px",
                                }}
                            >
                                <DocComponent />
                            </PaperFlex>
                            <PaperMenu name="tableofcontents">
                                <PaperText preset="section">
                                    Table of Contents
                                </PaperText>
                                <PaperMenuItem value="what-is-paperui">
                                    What is PaperUI?
                                </PaperMenuItem>
                                <PaperMenuItem value="thinking-in-paperui">
                                    Thinking in PaperUI
                                </PaperMenuItem>
                            </PaperMenu>
                        </PaperFlex>
                    </>
                ) : (
                    <PaperFlex
                        fullHeight
                        fullWidth
                        align="center"
                        justify="center"
                        direction="column"
                        gap="threefourths"
                    >
                        <PaperText weight={900} size={17}>
                            404
                        </PaperText>
                        <PaperText>
                            You've wandered far and wide, and gotten nowhere.
                        </PaperText>
                        <PaperLink href="/">Go somewhere</PaperLink>
                    </PaperFlex>
                )}
            </PaperProvider>
            <PaperContextMenu
                open={docsMenu.isOpen()}
                target={docsMenu.target()}
                placement={docsMenu.placement()}
                onClose={docsMenu.close}
            >
                <PaperContextMenuItem
                    icon={<PaperIcon src="/paperboard.png" />}
                    description="Do more with your computer."
                >
                    Paperboard
                </PaperContextMenuItem>
                <PaperSeparator />
                <PaperContextMenuHeader>For Devs</PaperContextMenuHeader>
                <PaperContextMenuItem
                    icon={<PaperIcon src="/paperapi.png" />}
                    description="Create memorable experiences."
                >
                    PaperAPI
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    icon={<PaperIcon src="/paperui.png" />}
                    description="Design beautiful interfaces."
                >
                    PaperUI
                </PaperContextMenuItem>
            </PaperContextMenu>
        </>
    );
}

export default App;
