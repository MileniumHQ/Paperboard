import { createSignal, For, onCleanup, onMount } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
    getVarCss,
} from "@mileniumhq/paperui";
import {
    MarketingButton,
    MarketingCard,
    MarketingProgress,
    MarketingSurface,
    MarketingText,
    createIconPlay,
} from "@mileniumhq/paperui/marketing";

// A demo surface is a stage of its own, a fixed height so the icons have room to play.
const stage = (rows: number) => ({ "min-height": `calc(${getVarCss("uigap")} * ${rows})`, "border-radius": getVarCss("border-radius") });
const centered = { display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", gap: getVarCss("uigap-double"), padding: getVarCss("uigap-double") } as const;

const DEMO_ICONS = ["/pictures/agents.png", "/pictures/game-server.png", "/pictures/blocks.png", "/pictures/discord-bot.png", "/pictures/crane.png"];
const DEMO_ICON_SIZE = 72;

const PICKS = [
    { name: "Game Server", banner: "/screens/gameserver-1.png", icon: "/pictures/game-server.png", accent: "#dc204c", description: "Run servers for your favorite games" },
    { name: "Bot Creator", banner: "/screens/botcreator-1.png", icon: "/pictures/discord-bot.png", accent: "#5865f2", description: "Make Discord bots without writing code" },
];

function PropTable(props: { rows: [string, string, string, string][] }) {
    return (
        <PaperTable>
            <thead>
                <tr>
                    <th>Prop</th>
                    <th>Type</th>
                    <th>Default</th>
                    <th>Effect</th>
                </tr>
            </thead>
            <tbody>
                <For each={props.rows}>
                    {(row) => (
                        <tr>
                            <td><PaperCode>{row[0]}</PaperCode></td>
                            <td><PaperCode>{row[1]}</PaperCode></td>
                            <td>{row[2]}</td>
                            <td>{row[3]}</td>
                        </tr>
                    )}
                </For>
            </tbody>
        </PaperTable>
    );
}

function IconPlayDemo() {
    let field: HTMLDivElement | undefined;
    let copy: HTMLDivElement | undefined;
    const icons: HTMLImageElement[] = [];
    onMount(() => {
        if (!field || !copy) throw new Error("The playground demo did not render");
        const play = createIconPlay(field, icons, {
            size: DEMO_ICON_SIZE,
            avoid: () => (copy ? [copy] : []),
            reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        });
        onCleanup(play.stop);
    });
    return (
        <MarketingSurface style={stage(26)}>
            <div ref={field} style={{ position: "relative", "min-height": `calc(${getVarCss("uigap")} * 26)`, ...centered }}>
                <div ref={copy}>
                    <MarketingText as="p" text="Fling one" size={56} />
                </div>
                <For each={DEMO_ICONS}>
                    {(src) => (
                        <img
                            ref={(el) => icons.push(el)}
                            src={src}
                            alt=""
                            draggable={false}
                            width={DEMO_ICON_SIZE}
                            height={DEMO_ICON_SIZE}
                            style={{ position: "absolute", top: 0, left: 0, cursor: "grab", "touch-action": "none" }}
                        />
                    )}
                </For>
            </div>
        </MarketingSurface>
    );
}

function CardDemo() {
    const [picked, setPicked] = createSignal<(typeof PICKS)[number]>();
    return (
        <MarketingSurface accent={picked()?.accent} style={stage(26)}>
            <div style={centered}>
                <PaperFlex direction="row" gap="double" wrap justify="center" fullWidth>
                    <For each={PICKS}>
                        {(pick) => (
                            <div style={{ width: `calc(${getVarCss("uigap")} * 26)` }}>
                                <MarketingCard
                                    banner={pick.banner}
                                    icon={pick.icon}
                                    title={pick.name}
                                    description={pick.description}
                                    selected={picked() === pick}
                                    onClick={() => setPicked(pick)}
                                />
                            </div>
                        )}
                    </For>
                </PaperFlex>
            </div>
        </MarketingSurface>
    );
}

export default function MarketingDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Marketing</PaperText>
            <PaperText preset="body" as="p">
                PaperUI Marketing is the look of Paperboard's own pages: the website and the onboarding.
                It is a separate part of PaperUI with its own script and stylesheet, so an app page never carries it and a marketing page needs none of the app components.
                Use it only for Paperboard's own first-party pages, never inside a panel.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Import the components from <PaperCode>@mileniumhq/paperui/marketing</PaperCode> and load <PaperCode>@mileniumhq/paperui/marketing.css</PaperCode> once.
                The stylesheet brings the color tokens and Nunito with it.
                Put everything inside a <PaperCode>MarketingSurface</PaperCode>: the other components take their colors from the surface's accent, so changing it recolors the whole page.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <MarketingSurface style={stage(22)}>
                    <div style={centered}>
                        <MarketingText as="p" text="Paperboard" size={96} />
                        <MarketingButton>Next</MarketingButton>
                    </div>
                </MarketingSurface>
            </PaperCard>
            <PaperCode block language="tsx">
{`import "@mileniumhq/paperui/marketing.css";
import { MarketingButton, MarketingSurface, MarketingText } from "@mileniumhq/paperui/marketing";

export function Welcome(props: { onNext: () => void }) {
    return (
        <MarketingSurface viewport>
            <MarketingText as="h1" text="Paperboard" size={190} />
            <MarketingButton size="large" onClick={props.onNext}>Next</MarketingButton>
        </MarketingSurface>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="surface">MarketingSurface</PaperText>
            <PaperText preset="body" as="p">
                The backdrop: the accent deepening toward the ink, the way the site darkens below its hero, under the paper grain.{" "}
                <PaperCode>depth</PaperCode> sinks it further, for a screen that sits behind the one before it.
                Changes to <PaperCode>accent</PaperCode> and <PaperCode>depth</PaperCode> glide.
            </PaperText>
            <PropTable
                rows={[
                    ["accent", "string", "PaperUI's primary", "The color the surface is made of; any CSS color."],
                    ["depth", "number", "0", "How far the surface sinks toward the ink, from 0 to 1."],
                    ["viewport", "boolean", "false", "Fill the viewport instead of the parent, for a full-screen page."],
                ]}
            />

            <PaperText preset="subheader" as="h2" id="text">MarketingText</PaperText>
            <PaperText preset="body" as="p">
                Display lettering: white Nunito with an accent-tinted inner edge, a soft drop and the grain.
                Screen readers hear the words, and the drawing shrinks to fit a narrow container.
                Use it for one heading per screen, not for body copy.
                It draws the <PaperCode>{"<marketing-text>"}</PaperCode> element, which a page without Solid uses directly (see <PaperCode>Without Solid</PaperCode> below).
            </PaperText>
            <PropTable
                rows={[
                    ["text", "string", "Required", "The words."],
                    ["size", "number", "Required", "Font size in pixels; the shadows and grain scale with it."],
                    ["as", '"h1" | "h2" | "h3" | "p" | "span"', '"span"', "The element that carries the words."],
                    ["fluid", "boolean", "false", "The page sets the font size instead, so a heading's wrapped lines share one size."],
                ]}
            />

            <PaperText preset="subheader" as="h2" id="button">MarketingButton</PaperText>
            <PaperText preset="body" as="p">
                A raised paper button on PaperEffect's edge: it lifts on hover and sinks onto the edge when pressed.{" "}
                <PaperCode>brand</PaperCode> is made of the surface's accent; <PaperCode>text</PaperCode> is the words alone, for a quieter way on such as skipping a step.
                An <PaperCode>svg</PaperCode> or <PaperCode>img</PaperCode> child sits beside the label at its size.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <MarketingSurface style={stage(14)}>
                    <div style={centered}>
                        <PaperFlex direction="row" gap="double" wrap justify="center" align="center">
                            <MarketingButton>Brand</MarketingButton>
                            <MarketingButton variant="black">Black</MarketingButton>
                            <MarketingButton variant="text">Continue without installing a panel</MarketingButton>
                        </PaperFlex>
                    </div>
                </MarketingSurface>
            </PaperCard>
            <PropTable
                rows={[
                    ["variant", '"brand" | "black" | "text"', '"brand"', "The face: the accent, ink, or none."],
                    ["size", '"medium" | "large"', '"medium"', "Large for the one action a screen leads to."],
                    ["onClick", "(e: MouseEvent) => void", "No default", "Called on a press."],
                    ["href", "string", "No default", "Makes the button a link; target and rel pass through."],
                    ["disabled", "boolean", "false", "Fades the button and ignores presses; a disabled link drops its href."],
                ]}
            />
            <PaperText preset="body" as="p">
                A page recolors and reshapes the buttons where they sit with these properties, such as white paper on a panel's color:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Property</th>
                        <th>Default</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--marketing-button-face</PaperCode></td><td>The surface's accent</td></tr>
                    <tr><td><PaperCode>--marketing-button-ink</PaperCode></td><td>White</td></tr>
                    <tr><td><PaperCode>--marketing-button-deep</PaperCode></td><td>The accent sunk toward the ink</td></tr>
                    <tr><td><PaperCode>--marketing-button-radius</PaperCode></td><td><PaperCode>12px</PaperCode></td></tr>
                    <tr><td><PaperCode>--marketing-button-padding</PaperCode>, <PaperCode>--marketing-button-gap</PaperCode></td><td>A medium button's own</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="card">MarketingCard</PaperText>
            <PaperText preset="body" as="p">
                A card to choose from: the surface itself, sunk a few shades and frosted, on a raised edge.
                With <PaperCode>onClick</PaperCode> it is a button that sinks onto its edge when pressed and springs back.
                The chosen card of a set takes <PaperCode>selected</PaperCode>. Pick one below to see the surface take its color.
                A card fills its cell and its description always stands two lines tall, so a set of cards is one height whatever their words; give each the same width.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <CardDemo />
            </PaperCard>
            <PropTable
                rows={[
                    ["title", "string", "Required", "The name."],
                    ["banner", "string", "No default", "A screenshot's address, cut to a wide strip across the top."],
                    ["icon", "string", "No default", "A picture's address, drawn bare above the title; under a banner it sits half over the banner's edge."],
                    ["subtitle", "string", "No default", "A line under the title, such as who made it."],
                    ["description", "string | JSX.Element", "No default", "A sentence on what choosing it does, kept to two lines."],
                    ["selected", "boolean", "false", "Marks the chosen card of a set; screen readers hear it pressed."],
                    ["onClick", "(e: MouseEvent) => void", "No default", "Makes the card a button."],
                ]}
            />

            <PaperText preset="subheader" as="h2" id="progress">MarketingProgress</PaperText>
            <PaperText preset="body" as="p">
                PaperProgress drawn in the surface's light, for a pause between two screens.
                It takes <PaperCode>value</PaperCode> from 0 to 100, or sweeps without one, and fills its container's width.
                Name it with <PaperCode>aria-label</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <MarketingSurface style={stage(10)}>
                    <div style={centered}>
                        <PaperFlex direction="column" gap="double" fullWidth>
                            <MarketingProgress value={60} aria-label="Known amount" />
                            <MarketingProgress aria-label="Unknown amount" />
                        </PaperFlex>
                    </div>
                </MarketingSurface>
            </PaperCard>

            <PaperText preset="subheader" as="h2" id="icon-play">Icon playground</PaperText>
            <PaperText preset="body" as="p">
                Paper icons to fling, as on the site's last screen and the phone's welcome.{" "}
                <PaperCode>createIconPlay</PaperCode> scatters the icons around the copy the first time the field is on screen; a dragged icon is tossed and bounces off the edges, the copy and the other icons by their visible shapes, and a tap spins one in place.
                Icons never cover the copy, and the simulation sleeps while the field is off screen.
                Give the field <PaperCode>position: relative</PaperCode>, and the icons <PaperCode>position: absolute</PaperCode> at the top left, at <PaperCode>size</PaperCode> pixels square.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <IconPlayDemo />
            </PaperCard>
            <PaperCode block language="tsx">
{`onMount(() => {
    const play = createIconPlay(field, icons, {
        size: 72,
        avoid: () => [copy],
        reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        onTap: () => haptic("light"),
    });
    play.ready.catch((err) => showError("The icons couldn't be placed", err));
    onCleanup(play.stop);
});`}
            </PaperCode>
            <PropTable
                rows={[
                    ["size", "number", "Required", "Each icon's size in pixels."],
                    ["avoid", "() => Element[]", "Required", "The copy the icons are scattered around and bounce off."],
                    ["reduceMotion", "boolean", "Required", "No tossing or spinning: icons stay where they are put."],
                    ["onImpact", "() => void", "No default", "An icon hit an edge or another icon hard, for a haptic."],
                    ["onTap", "() => void", "No default", "An icon was tapped rather than dragged."],
                ]}
            />
            <PaperText preset="body" as="p">
                It returns <PaperCode>ready</PaperCode>, which rejects if the icons' shapes can't be read, and <PaperCode>stop()</PaperCode>, which ends it and hands the icons back to the page's own styles.
                The field's <PaperCode>data-play-state</PaperCode> is <PaperCode>moving</PaperCode> or <PaperCode>resting</PaperCode>, and a held icon has <PaperCode>data-dragging</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="without-solid">Without Solid</PaperText>
            <PaperText preset="body" as="p">
                A page that runs no framework, such as the prerendered site, imports <PaperCode>@mileniumhq/paperui/marketing/elements</PaperCode>: no components and no stylesheet, only <PaperCode>defineMarketingText()</PaperCode> and <PaperCode>createIconPlay</PaperCode>.
                Load it as a classic script in the head, so each heading is drawn as the parser reaches it, and write the lettering as an element.{" "}
                <PaperCode>fluid</PaperCode> takes the size from the page's <PaperCode>font-size</PaperCode>.
                Buttons are plain markup, so a server-rendered <PaperCode>MarketingButton</PaperCode> needs no script.
            </PaperText>
            <PaperCode block language="html">
{`<marketing-text size="48" text="Paperboard">Paperboard</marketing-text>`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Under reduced motion the icons stay where they are put, the progress bar stops sweeping, and presses and color changes snap.</li>
                <li>A surface's accent recolors every component inside it: the text's inner edge, the brand button's face and edge, and the cards.</li>
                <li>The grain is part of each component, so there is nothing else to load.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
