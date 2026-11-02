import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperMediaCardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperMediaCard</PaperText>
            <PaperText preset="body">
                PaperMediaCard presents an application tile with optional banner images, icons, descriptive text, and actions.
                Reach for PaperMediaCard when building panel catalogs, store listings, game servers, or media dashboards.
                A clickable card outlines its border on hover. It supports badge chips and responsive card grids.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Specify title, description, and icon props to construct an application card.
                Add action buttons in the footerLeft or footerRight slots.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMediaCard, PaperBadge, PaperButton, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="back">
            <PaperMediaCard
                icon="terminal"
                title="Terminal"
                subtitle="v3.0.0"
                description="Interactive shell and multi-tab console."
                badge={<PaperBadge variant="success">Installed</PaperBadge>}
                footerRight={<PaperButton size="small" variant="primary">Launch</PaperButton>}
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="back">
                <PaperMediaCard
                    icon="terminal"
                    title="Terminal"
                    subtitle="v3.0.0"
                    description="Interactive shell and multi-tab console."
                    badge={<PaperBadge variant="success">Installed</PaperBadge>}
                    footerRight={<PaperButton size="small" variant="primary">Launch</PaperButton>}
                />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperMediaCard accepts the following configuration properties:
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Prop</th>
                            <th>Type</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>Primary header text.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>subtitle</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Secondary metadata line rendered under the title.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>description</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Body explanation text, clamped to three lines.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>descriptionExtra</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Content below the description, outside its line clamp and pinned to the card's bottom edge so cards in a row align. Use it for meters or status rows.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Icon ligature name or image URL.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>poster</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Portrait (2:3) cover art image URL, standing in the icon's place and replacing it. Under a <PaperCode>banner</PaperCode> it overlaps the banner's bottom edge with the text beside it; without one it stands above the title. <PaperCode>posterAlt</PaperCode> describes it.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>banner</PaperCode></td>
                            <td><PaperCode>string | string[] | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Header graphic: a picture URL, a list of URLs or a custom component. A list of up to four URLs tiles as one picture, for a card that stands for several things (a playlist, a mix of maps); <PaperCode>bannerAlt</PaperCode> describes the whole set.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>badge</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Corner status badge chip.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>footerLeft</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Content placed in the bottom-left corner of the card.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>footerRight</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Actions placed in the bottom-right corner of the card.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>selected</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Marks the card as the chosen one of a set: its border takes the primary color and assistive technology hears it pressed. Set it to <PaperCode>false</PaperCode> on the others; leave it unset on cards that open something.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>effect</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Whether a clickable card follows the pointer with PaperEffect. Turn it off for a grid of many cards, where the motion is noise.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When onClick or href is passed, the card outlines its border on hover and, unless effect is false, wraps itself in PaperEffect.
                Keyboard navigation triggers onClick when pressing Enter or Space.
                The whole card is the click target, footer row included; a click on a control inside it (a button, toggle, field or link) only does what that control does.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Arrange cards in a responsive catalog using PaperMediaCardGroup.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCardGroup minCardWidth="field">
    <PaperMediaCard icon="extension" title="Extension 1" />
    <PaperMediaCard icon="extension" title="Extension 2" />
</PaperMediaCardGroup>`}
            </PaperCode>
            <PaperCard padding="double" surface="back">
                <PaperMediaCardGroup minCardWidth="field">
                    <PaperMediaCard icon="extension" title="Extension 1" />
                    <PaperMediaCard icon="extension" title="Extension 2" />
                </PaperMediaCardGroup>
            </PaperCard>
            <PaperText preset="body">
                Choose one of several with <PaperCode>selected</PaperCode>. A banner picture loads when its card scrolls into view, so a long grid of pictures only fetches what is seen.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCardGroup minCardWidth="field">
    <For each={maps}>
        {(map) => <PaperMediaCard banner={map.picture} title={map.name} selected={map.name === chosen()} onClick={() => setChosen(map.name)} />}
    </For>
</PaperMediaCardGroup>`}
            </PaperCode>
            <PaperText preset="body">
                Give a banner a list of pictures and they tile as one, for a card that stands for several things.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCard
    banner={["/maps/ctf_2fort.png", "/maps/cp_dustbowl.png", "/maps/pl_badwater.png", "/maps/koth_viaduct.png"]}
    bannerAlt="Four of the server's maps"
    title="Mixed"
    description="Every kind of map."
/>`}
            </PaperCode>
            <PaperText preset="body">
                Pair a banner with a poster to present something with cover art, such as a game to choose.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCardGroup minCardWidth="field-wide">
    <PaperMediaCard
        banner="/assets/games/terraria/banner.webp"
        poster="/assets/games/terraria/poster.webp"
        posterAlt="Terraria cover art"
        title="Terraria"
        onClick={() => pick("terraria")}
    />
</PaperMediaCardGroup>`}
            </PaperCode>
        </PaperFlex>
    );
}
