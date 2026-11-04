import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperProgress,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperMediaCardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperMediaCard</PaperText>
            <PaperText preset="body" as="p">
                PaperMediaCard is a card with a picture on top, a title, and a short description, built to be clicked.
                Use it to pick one thing from a set, such as a game, a map, or a template, and lay the set out with PaperMediaCardGroup.
                For a plain container with no picture, use <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>title</PaperCode> is the only required prop.
                Passing <PaperCode>onClick</PaperCode> or <PaperCode>href</PaperCode> makes the card interactive.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMediaCardGroup>
                    <PaperMediaCard
                        icon="deployed_code"
                        title="Card"
                        subtitle="Subtitle"
                        description="A short description that explains what choosing this card does."
                        badge={<PaperBadge variant="success">Badge</PaperBadge>}
                        onClick={() => undefined}
                    />
                    <PaperMediaCard
                        icon="deployed_code"
                        title="Selected"
                        description="The chosen card of a set has a primary border."
                        selected
                        onClick={() => undefined}
                    />
                </PaperMediaCardGroup>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperMediaCard, PaperMediaCardGroup } from "@mileniumhq/paperui";

export function Example(props: { onOpen: () => void }) {
    return (
        <PaperMediaCardGroup>
            <PaperMediaCard
                icon="deployed_code"
                title="Card"
                subtitle="Subtitle"
                description="A short description that explains what choosing this card does."
                badge={<PaperBadge variant="success">Badge</PaperBadge>}
                onClick={props.onOpen}
            />
            <PaperMediaCard
                icon="deployed_code"
                title="Selected"
                description="The chosen card of a set has a primary border."
                selected
                onClick={props.onOpen}
            />
        </PaperMediaCardGroup>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="card-props">PaperMediaCard</PaperText>
            <PaperText preset="body" as="p">
                PaperMediaCardProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode> and <PaperCode>onClick</PaperCode>, which it redefines.
                Other props land on the card element, a <PaperCode>div</PaperCode> or, with <PaperCode>href</PaperCode>, an <PaperCode>a</PaperCode>.
                Children render in a content area under the description.
            </PaperText>
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
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The card's name. A long word with no spaces, such as a file name, breaks instead of overflowing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subtitle</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>A line of subdued text under the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Text under the title. It is cut off after three lines.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>descriptionExtra</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Content under the description that is never cut off, for a meter or a status row. It sits at the bottom of the card body, so cards of different text lengths in one row line it up.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Free content in an area under the description and its extra.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>footerLeft</PaperCode>, <PaperCode>footerRight</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>A footer row with content at each end. The row renders when either is set. The whole row opens the card except where it holds a control.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>badge</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>An element at the end of the title row, such as a <PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>banner</PaperCode></td>
                        <td><PaperCode>string | readonly string[] | JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The picture across the top. Without it the card has no banner. A string is an image address. A list of addresses tiles up to the first four as one picture, and an empty list means no banner. Any element is drawn as given.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>bannerAlt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>What the banner shows, with an empty alt text when unset. A single address uses it as the image's alt text. A tiled set is one image to assistive technology, named by it. An element banner ignores it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>bannerHeight</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A CSS height for the banner area, such as <PaperCode>"12rem"</PaperCode>. Without it the area is eight times the base gap tall.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>A small mark for the card. A string starting with <PaperCode>http</PaperCode>, <PaperCode>/</PaperCode>, or <PaperCode>data:</PaperCode> is an image address. Any other string is a Material icon name. With a banner the icon overlaps the banner's bottom edge. Without one it stands above the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>plainIcon</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws an icon image without its framed badge, a little larger. Glyph icons are unaffected.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>poster</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>An image address for portrait cover art in a 2:3 frame. It replaces <PaperCode>icon</PaperCode>. With a banner it overlaps the banner's bottom edge and the text sits beside it. Without one it stands above the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>posterAlt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The poster's alt text, empty when unset. Set it, such as "Terraria cover art".</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClick</PaperCode></td>
                        <td><PaperCode>(e: MouseEvent) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Runs when the card is clicked or activated by keyboard, except for clicks on a control inside it. Not called when the card is disabled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Renders the card as an anchor that navigates.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode>, <PaperCode>rel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Passed to the anchor. Not set for you: add <PaperCode>rel="noopener noreferrer"</PaperCode> yourself with <PaperCode>target="_blank"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>interactive</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>True when <PaperCode>onClick</PaperCode> or <PaperCode>href</PaperCode> is set. Gives the card the hover border, the button role, and keyboard focus. Set it to <PaperCode>false</PaperCode> on a card that has an <PaperCode>onClick</PaperCode> but should look inert. A disabled card is never interactive.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>selected</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (unset)</td>
                        <td>Marks the chosen card of a set with a primary border. Leave it unset on cards that open something. See Accessibility.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the card, ignores pointer events, cancels the click, and sets <PaperCode>aria-disabled</PaperCode>. The click is cancelled for an anchor too, so it does not navigate.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>effect</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Wraps an interactive card in <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> for the paper-shadow press. <PaperCode>false</PaperCode> removes it. A card that is not interactive has no effect either way.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the card element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="group-props">PaperMediaCardGroup</PaperText>
            <PaperText preset="body" as="p">
                PaperMediaCardGroup lays cards out in a responsive grid.
                Its props extend <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
            </PaperText>
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
                    <tr>
                        <td><PaperCode>minCardWidth</PaperCode></td>
                        <td><PaperCode>PaperSize | string</PaperCode></td>
                        <td><PaperCode>"card-min"</PaperCode></td>
                        <td>The narrowest a card gets before the grid starts a new row. A size token such as <PaperCode>"card-min"</PaperCode> (256 pixels) or <PaperCode>"field-wide"</PaperCode> (240 pixels), or a CSS length. Cards stretch to share the row.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>style</PaperCode></td>
                        <td>Solid prop</td>
                        <td>No default</td>
                        <td>An object <PaperCode>style</PaperCode> is merged after the grid's own.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="clicks">Clicks and keyboard</PaperText>
            <PaperTextList>
                <li>An interactive card that is not an anchor has <PaperCode>role="button"</PaperCode> and is focusable. Enter and Space on the card itself fire a click, so <PaperCode>onClick</PaperCode> handles both pointer and keyboard.</li>
                <li>A click that lands on a control inside the card is that control's alone, and does not reach the card's <PaperCode>onClick</PaperCode>. Controls are links, buttons, inputs, selects, text areas, labels, and anything with a button, switch, checkbox, menuitem, or similar role, or a <PaperCode>tabindex</PaperCode>.</li>
                <li>Keys pressed on a control inside the card also stay with it.</li>
                <li>With <PaperCode>href</PaperCode> the card is a native anchor, so Enter navigates, and <PaperCode>onClick</PaperCode> still runs first.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="layout">Layout</PaperText>
            <PaperTextList>
                <li>The card fills its grid cell. Cards in one row take the height of the tallest, and <PaperCode>descriptionExtra</PaperCode> lines up at the bottom of each.</li>
                <li>Images load lazily, so a grid of many cards does not fetch every picture at once.</li>
                <li>Hover shows a primary border. There is no lift.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li><PaperCode>selected</PaperCode> sets <PaperCode>aria-pressed</PaperCode> on an interactive, non-anchor card, <PaperCode>"true"</PaperCode> for the chosen card and <PaperCode>"false"</PaperCode> for the others. A card with <PaperCode>selected</PaperCode> unset has no <PaperCode>aria-pressed</PaperCode>. An anchor never has it.</li>
                <li>A disabled card has <PaperCode>aria-disabled="true"</PaperCode>.</li>
                <li>A banner image uses <PaperCode>bannerAlt</PaperCode>. Set it whenever the picture says something the title does not.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="picker">Picking one of a set</PaperText>
            <PaperText preset="body" as="p">
                Mark the current choice with <PaperCode>selected</PaperCode> and change it in <PaperCode>onClick</PaperCode>.
                The gameserver panel's map step does this for its map modes.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import { PaperMediaCard, PaperMediaCardGroup } from "@mileniumhq/paperui";

const modes = [
    { id: "survival", name: "Survival", detail: "Stay alive as long as you can." },
    { id: "creative", name: "Creative", detail: "Build with unlimited blocks." },
    { id: "sandbox", name: "Sandbox", detail: "Try things with no rules." },
];

export function ModePicker() {
    const [mode, setMode] = createSignal("survival");

    return (
        <PaperMediaCardGroup minCardWidth="field-wide">
            <For each={modes}>
                {(item) => (
                    <PaperMediaCard
                        icon="sports_esports"
                        title={item.name}
                        description={item.detail}
                        selected={mode() === item.id}
                        onClick={() => setMode(item.id)}
                    />
                )}
            </For>
        </PaperMediaCardGroup>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="poster">Cover art with a banner</PaperText>
            <PaperText preset="body" as="p">
                A banner with a poster puts the cover art over the banner's bottom edge and the text beside it.
                The gameserver panel's game picker uses this.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMediaCard, PaperMediaCardGroup } from "@mileniumhq/paperui";

export function GamePicker(props: {
    games: { id: string; name: string; tagline: string; banner: string; poster: string }[];
    onPick: (id: string) => void;
}) {
    return (
        <PaperMediaCardGroup minCardWidth="card-min">
            {props.games.map((game) => (
                <PaperMediaCard
                    banner={game.banner}
                    poster={game.poster}
                    posterAlt={game.name + " cover art"}
                    title={game.name}
                    description={game.tagline}
                    onClick={() => props.onPick(game.id)}
                />
            ))}
        </PaperMediaCardGroup>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="mosaic">One card for several pictures</PaperText>
            <PaperText preset="body" as="p">
                Give <PaperCode>banner</PaperCode> a list of addresses for a card that stands for several things.
                Describe the set once in <PaperCode>bannerAlt</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMediaCard
    banner={["/maps/one.png", "/maps/two.png", "/maps/three.png", "/maps/four.png"]}
    bannerAlt="Four of its maps"
    title="Mixed"
    description="Every kind of map."
    onClick={() => undefined}
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="footer-controls">Controls inside a card</PaperText>
            <PaperText preset="body" as="p">
                A button in the footer or content runs by itself.
                A click anywhere else on the card, the footer row included, opens it.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperMediaCardGroup>
                    <PaperMediaCard
                        icon="dns"
                        title="Server"
                        description="Click the card to open it."
                        descriptionExtra={<PaperProgress value={60} aria-label="Disk used" />}
                        footerLeft={<PaperText preset="caption" as="span">12 players</PaperText>}
                        footerRight={<PaperButton size="tiny" variant="outline">Rename</PaperButton>}
                        onClick={() => undefined}
                    />
                </PaperMediaCardGroup>
            </PaperCard>
            <PaperCode block language="tsx">
{`import {
    PaperButton,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperProgress,
    PaperText,
} from "@mileniumhq/paperui";

<PaperMediaCardGroup>
    <PaperMediaCard
        icon="dns"
        title="Server"
        description="Click the card to open it."
        descriptionExtra={<PaperProgress value={60} aria-label="Disk used" />}
        footerLeft={<PaperText preset="caption" as="span">12 players</PaperText>}
        footerRight={<PaperButton size="tiny" variant="outline">Rename</PaperButton>}
        onClick={() => undefined}
    />
</PaperMediaCardGroup>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A choice with no picture belongs in <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink>.</li>
                <li>A container for settings or content, with no picture and no click, is <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>.</li>
                <li>A long list of rows is <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
