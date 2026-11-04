import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSwatch,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSwatchDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSwatch</PaperText>
            <PaperText preset="body" as="p">
                PaperSwatch is a small round dot of one color, in three sizes.
                Use it beside a label to show a role color, a user-chosen color, or a status marker.
                A dot is not text: always pair it with words that say the same thing.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>color</PaperCode> takes a PaperUI color token or a CSS color.
                Without it the dot is the neutral border color.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperSwatch />
                    <PaperSwatch color="success" />
                    <PaperSwatch color="danger" />
                    <PaperSwatch color="#8844ee" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperSwatch } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="row" gap="full" align="center" wrap>
            <PaperSwatch />
            <PaperSwatch color="success" />
            <PaperSwatch color="danger" />
            <PaperSwatch color="#8844ee" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSwatchProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLSpanElement&gt;</PaperCode>.
                Other props land on the dot's <PaperCode>span</PaperCode>.
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
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>No default (the border color)</td>
                        <td>The fill. See Colors.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperSwatchSize</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td><PaperCode>"small"</PaperCode> (8 pixels), <PaperCode>"medium"</PaperCode> (12), or <PaperCode>"large"</PaperCode> (16).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the dot. An object <PaperCode>style</PaperCode> is merged after the fill, so its <PaperCode>background</PaperCode> wins.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="colors">Colors</PaperText>
            <PaperTextList>
                <li>A token name resolves to its theme color: a role such as <PaperCode>"success"</PaperCode>, a surface, a border, or a text color. The color follows the light or dark theme.</li>
                <li>A hex value, a CSS color function such as <PaperCode>rgb(...)</PaperCode> or <PaperCode>oklch(...)</PaperCode>, <PaperCode>currentColor</PaperCode>, and <PaperCode>transparent</PaperCode> are used as written.</li>
                <li>Any other word is read as a token name. A CSS keyword such as <PaperCode>red</PaperCode> is not a token and draws no fill: use a hex value for it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperText preset="body" as="p">
                The dot is an empty <PaperCode>span</PaperCode> with no role and no text.
                Put the meaning in the label beside it. Set <PaperCode>title</PaperCode> for a hover hint, or <PaperCode>role="img"</PaperCode> with <PaperCode>aria-label</PaperCode> when the dot stands alone.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="sizes">Sizes</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperSwatch size="small" color="primary" />
                    <PaperSwatch size="medium" color="primary" />
                    <PaperSwatch size="large" color="primary" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center" wrap>
    <PaperSwatch size="small" color="primary" />
    <PaperSwatch size="medium" color="primary" />
    <PaperSwatch size="large" color="primary" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="with-label">Beside a label</PaperText>
            <PaperText preset="body" as="p">
                The bot panel marks each Discord role with its own color, and the gameserver panel shows each chat color the same way.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperSwatch color="success" />
                    <PaperText preset="text" as="span">Online</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperSwatch, PaperText } from "@mileniumhq/paperui";

<PaperFlex direction="row" gap="half" align="center">
    <PaperSwatch color="success" />
    <PaperText preset="text" as="span">Online</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A word or number with a color is <PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink>.</li>
                <li>A metric with an icon and a meter is <PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
