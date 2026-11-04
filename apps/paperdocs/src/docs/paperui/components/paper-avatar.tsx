import {
    PaperAvatar,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const image = "/paperboard.png";

export default function PaperAvatarDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperAvatar</PaperText>
            <PaperText preset="body" as="p">
                PaperAvatar shows a picture of a person, bot, game, or app, and falls back to an icon tile when there is no picture.
                Use it for player heads, bot icons, and add-on or package icons.
                Give it an <PaperCode>onEdit</PaperCode> handler to turn it into a change-picture button.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>src</PaperCode> for the picture.
                Without <PaperCode>src</PaperCode> the avatar draws a Material icon on a tile, <PaperCode>person</PaperCode> unless you set <PaperCode>fallbackIcon</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar src={image} alt="Paperboard" />
                    <PaperAvatar />
                    <PaperAvatar fallbackIcon="smart_toy" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperAvatar, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperAvatar src="/paperboard.png" alt="Paperboard" />
                <PaperAvatar />
                <PaperAvatar fallbackIcon="smart_toy" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperAvatarProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLSpanElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>span</PaperCode>.
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
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Image URL. The image fills the avatar, cropped to cover. When it is empty or missing, the icon tile shows instead.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>alt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>""</PaperCode></td>
                        <td>Alternative text of the image. Empty marks the picture as decorative, so set it when the avatar is the only place the name appears.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperAvatarSize</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td><PaperCode>"small"</PaperCode>, <PaperCode>"medium"</PaperCode>, <PaperCode>"large"</PaperCode>, or <PaperCode>"xlarge"</PaperCode>: 24, 32, 48, or 64 pixels on a side (<PaperCode>--paper-avatar-size-*</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>shape</PaperCode></td>
                        <td><PaperCode>"circle" | "square" | "sharp"</PaperCode></td>
                        <td><PaperCode>"circle"</PaperCode></td>
                        <td><PaperCode>"square"</PaperCode> rounds the corners for app and package icons. <PaperCode>"sharp"</PaperCode> keeps square corners for art that draws its own edge, such as pixel art.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fallbackIcon</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"person"</PaperCode></td>
                        <td>Material icon name drawn on the tile when <PaperCode>src</PaperCode> is missing or fails to load.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>accent</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default</td>
                        <td>Tints the tile and its icon with a role color. Applies to the fallback only, never to an image. Roles: <PaperCode>primary</PaperCode>, <PaperCode>brand</PaperCode>, <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onEdit</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Adds a button over the whole avatar. It appears on hover and keyboard focus, darkens the avatar, and shows an edit icon. The handler gets no arguments.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>editLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Edit"</PaperCode></td>
                        <td>Accessible name and tooltip of the edit button. Used only with <PaperCode>onEdit</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The fallback tile has a surface background. An image avatar has none, so transparent pixels in the image show the page behind it.</li>
                <li>An image that fails to load is replaced by the fallback icon on its tile. A new <PaperCode>src</PaperCode> is tried again.</li>
                <li>The fallback icon is hidden from assistive technology. A fallback avatar has no accessible name, so put the name in nearby text.</li>
                <li>With <PaperCode>onEdit</PaperCode> the edit button is a real <PaperCode>button</PaperCode> and takes keyboard focus. It is invisible until hovered or focused.</li>
                <li>The avatar never shrinks inside a flex row.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="sizes-and-shapes">Sizes and shapes</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar src={image} size="small" />
                    <PaperAvatar src={image} size="medium" />
                    <PaperAvatar src={image} size="large" />
                    <PaperAvatar src={image} size="xlarge" />
                    <PaperAvatar src={image} size="large" shape="square" />
                    <PaperAvatar src={image} size="large" shape="sharp" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperAvatar src="/paperboard.png" size="small" />
    <PaperAvatar src="/paperboard.png" size="medium" />
    <PaperAvatar src="/paperboard.png" size="large" />
    <PaperAvatar src="/paperboard.png" size="xlarge" />
    <PaperAvatar src="/paperboard.png" size="large" shape="square" />
    <PaperAvatar src="/paperboard.png" size="large" shape="sharp" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="accent">Mark the active item</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>accent</PaperCode> on the fallback tile of the selected item in a set.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar fallbackIcon="dns" />
                    <PaperAvatar fallbackIcon="dns" accent="primary" />
                    <PaperAvatar fallbackIcon="dns" accent="danger" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperAvatar fallbackIcon="dns" />
    <PaperAvatar fallbackIcon="dns" accent="primary" />
    <PaperAvatar fallbackIcon="dns" accent="danger" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="editable">Change a picture</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>onEdit</PaperCode> and open your own picker from it.
                Hover or focus the avatar to see the control.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperAvatar } from "@mileniumhq/paperui";

export function BotIcon(props: { src?: string; onPick: () => void }) {
    return (
        <PaperAvatar
            src={props.src}
            size="xlarge"
            shape="square"
            fallbackIcon="smart_toy"
            alt="Bot icon"
            onEdit={props.onPick}
            editLabel="Change icon"
        />
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="in-panels">Use in panels</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel draws player heads with <PaperCode>shape="sharp"</PaperCode> so the pixel art keeps its edge, game and add-on icons with <PaperCode>shape="square"</PaperCode>, and passes a <PaperCode>fallbackIcon</PaperCode> that matches the item kind.
                Show an avatar inside a row of a <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>, or beside a name, and use <PaperLink href="/docs/paperui/papericon/">PaperIcon</PaperLink> for a bare glyph with no tile.
            </PaperText>
        </PaperFlex>
    );
}
