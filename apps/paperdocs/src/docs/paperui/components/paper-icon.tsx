import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperIconDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperIcon</PaperText>
            <PaperText preset="body" as="p">
                PaperIcon draws a Material Symbols icon from its name, an image from a URL, or a short text monogram.
                Use it for glyphs beside text, inside buttons, and for the icon of a package, bot, or action.
                The icon takes the size and color of the text around it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put the icon name in the children.
                Names come from the Material Symbols Rounded set, which PaperUI bundles with every symbol and ligature, so <PaperCode>home</PaperCode>, <PaperCode>content_copy</PaperCode>, and <PaperCode>smart_toy</PaperCode> all work.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperIcon>home</PaperIcon>
                    <PaperIcon>settings</PaperIcon>
                    <PaperIcon label="Server online">check_circle</PaperIcon>
                    <PaperIcon monogram>AB</PaperIcon>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperFlex, PaperIcon } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperIcon>home</PaperIcon>
                <PaperIcon>settings</PaperIcon>
                <PaperIcon label="Server online">check_circle</PaperIcon>
                <PaperIcon monogram>AB</PaperIcon>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperIconProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLSpanElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>span</PaperCode>, and explicit <PaperCode>aria-*</PaperCode> props win over the ones PaperIcon sets.
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The Material Symbols name, or with <PaperCode>monogram</PaperCode> the text to show. Ignored when <PaperCode>src</PaperCode> is set. An unknown name draws its letters as text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (decorative)</td>
                        <td>Gives the icon <PaperCode>role="img"</PaperCode> and this accessible name. Without it the icon is <PaperCode>aria-hidden</PaperCode>, because the ligature text is never a name. Set it only when no nearby text says the same thing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Draws an image, one em square, instead of a symbol.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>alt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>""</PaperCode></td>
                        <td>Alternative text of the image. Only used with <PaperCode>src</PaperCode> and without <PaperCode>tint</PaperCode>. The icon is still hidden from assistive technology unless <PaperCode>label</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tint</PaperCode></td>
                        <td><PaperCode>boolean | PaperColor</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws the image as a stencil, for one-color logos. Only the image's transparency matters. <PaperCode>true</PaperCode> uses the current text color; a color name such as <PaperCode>"text"</PaperCode> uses that color, for a logo inside a control that colors its icons, like PaperSelectorItem.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pixelated</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Keeps pixel art crisp when the image is scaled up. Does not apply with <PaperCode>tint</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>monogram</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws the children as bold rounded text in a square box, such as two initials, instead of a symbol.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>zeroHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Gives the icon box no height, so a glyph inside a line of text does not make the line taller.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>PaperIcon has no size prop. A symbol is drawn at the font size of its parent, so size it with the parent: a PaperButton sets the glyph size by its <PaperCode>size</PaperCode>, and a PaperText sets it by its text size. Color follows the parent's text color.</li>
                <li>Symbols are drawn filled, at weight 500. The outline form is not selectable per icon.</li>
                <li>The icon is not selectable text. Put it inside a control for a clickable icon, and name the control: an icon button's name comes from <PaperCode>title</PaperCode> or <PaperCode>aria-label</PaperCode>, never from the glyph.</li>
                <li>A string icon prop on other components, such as <PaperCode>icon="search"</PaperCode> on PaperInput or PaperBadge, renders through PaperIcon.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="in-button">Beside a label</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperButton variant="primary">
                    <PaperIcon>add</PaperIcon>
                    New item
                </PaperButton>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperIcon } from "@mileniumhq/paperui";

<PaperButton variant="primary">
    <PaperIcon>add</PaperIcon>
    New item
</PaperButton>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="status">A status icon with a name</PaperText>
            <PaperText preset="body" as="p">
                When the icon is the only carrier of the meaning, pass <PaperCode>label</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperIcon } from "@mileniumhq/paperui";

export function OnlineMark(props: { online: boolean }) {
    return props.online
        ? <PaperIcon label="Online">check_circle</PaperIcon>
        : <PaperIcon label="Offline">cancel</PaperIcon>;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="image">An image icon</PaperText>
            <PaperText preset="body" as="p">
                The actions panel draws a category's image icon with <PaperCode>src</PaperCode>.
                Use <PaperCode>tint</PaperCode> for a single-color logo that should follow the text color, and <PaperCode>pixelated</PaperCode> for pixel art.
                A PaperSelectorItem draws its icon in the primary color. A maker's logo there names <PaperCode>tint="text"</PaperCode> so it stays one neutral color.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperIcon } from "@mileniumhq/paperui";

<PaperIcon src="/logo.svg" tint />
<PaperIcon src="/maker.svg" tint="text" />
<PaperIcon src="/pixel-icon.png" pixelated />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="monogram">Initials</PaperText>
            <PaperCode block language="tsx">
{`import { PaperIcon } from "@mileniumhq/paperui";

export function Initials(props: { name: string }) {
    return <PaperIcon monogram>{props.name.trim().slice(0, 2).toUpperCase()}</PaperIcon>;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperavatar/">PaperAvatar</PaperLink> for a picture of a person or item on a tile with a fallback, and PaperIcon for a bare glyph.
            </PaperText>
        </PaperFlex>
    );
}
