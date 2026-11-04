import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperTextListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperTextList</PaperText>
            <PaperText preset="body" as="p">
                PaperTextList is a bulleted or numbered list of text, with the same size, weight, and color options as PaperText.
                Use it for short points, steps, or notes inside a page.
                For rows that hold controls or open something, use <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Children are <PaperCode>li</PaperCode> elements or <PaperCode>PaperTextList.Item</PaperCode>.
                An unordered list is the default.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperTextList>
                    <li>First point</li>
                    <li>Second point</li>
                    <li>Third point</li>
                </PaperTextList>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperTextList } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperTextList>
            <li>First point</li>
            <li>Second point</li>
            <li>Third point</li>
        </PaperTextList>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="list-props">PaperTextList</PaperText>
            <PaperText preset="body" as="p">
                PaperTextListProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLUListElement | HTMLOListElement&gt;</PaperCode>.
                Other props land on the <PaperCode>ul</PaperCode> or <PaperCode>ol</PaperCode>. An object <PaperCode>style</PaperCode> is merged after the component's own.
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
                        <td><PaperCode>ordered</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (bulleted)</td>
                        <td>Renders an <PaperCode>ol</PaperCode> with numbers instead of a <PaperCode>ul</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>start</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (1)</td>
                        <td>The first number of an ordered list. An unordered list ignores it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The CSS list marker: <PaperCode>"disc"</PaperCode>, <PaperCode>"circle"</PaperCode>, <PaperCode>"square"</PaperCode>, <PaperCode>"decimal"</PaperCode>, <PaperCode>"none"</PaperCode>, or any other CSS <PaperCode>list-style-type</PaperCode> value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>spacing</PaperCode></td>
                        <td><PaperCode>"compact" | "normal" | "relaxed"</PaperCode></td>
                        <td><PaperCode>"normal"</PaperCode></td>
                        <td>The gap between items: a quarter, a half, or a full base gap.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>PaperTextPreset</PaperCode></td>
                        <td>No default</td>
                        <td>A <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink> preset for the list. Its size, weight, and styling apply to every item. A <PaperCode>PaperTextList.Item</PaperCode> inherits it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default</td>
                        <td>A step of the text scale, 0 to 17, as in PaperText. Without it the preset's size applies, or 3 with no preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>weight</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default</td>
                        <td>A CSS font weight. Without it the preset's weight applies, or 400 with no preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>No default</td>
                        <td>A color token or a CSS color, as in PaperText.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>family</PaperCode></td>
                        <td><PaperCode>"body" | "code"</PaperCode></td>
                        <td><PaperCode>"body"</PaperCode></td>
                        <td><PaperCode>"code"</PaperCode> switches to the monospace font.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rounded</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Uses the rounded font family.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>breakWord</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Breaks long unbroken words.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>truncate</PaperCode></td>
                        <td><PaperCode>boolean | number</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Cuts each item to one line with an ellipsis, or to that many lines with a number above 1.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the list.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperTextList.Item</PaperText>
            <PaperText preset="body" as="p">
                PaperTextList.Item is a <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink> that renders an <PaperCode>li</PaperCode> and takes all of its props.
                An item takes the list's <PaperCode>preset</PaperCode>, <PaperCode>size</PaperCode>, <PaperCode>weight</PaperCode>, <PaperCode>color</PaperCode>, <PaperCode>family</PaperCode>, <PaperCode>rounded</PaperCode>, <PaperCode>breakWord</PaperCode>, and <PaperCode>truncate</PaperCode> unless it sets its own.
                Pass <PaperCode>as</PaperCode> to render another element.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The list indents its markers outside the text, with a bottom margin of a half gap.</li>
                <li>Plain <PaperCode>li</PaperCode> children work and take the list's own size, weight, and color. Use <PaperCode>PaperTextList.Item</PaperCode> only when one item needs a prop of PaperText, such as its own color.</li>
                <li>Lists nest: put a <PaperCode>PaperTextList</PaperCode> inside an item.</li>
                <li>The list is a real <PaperCode>ul</PaperCode> or <PaperCode>ol</PaperCode>, so assistive technology announces it as a list.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="steps">Numbered steps</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperTextList ordered spacing="compact">
                    <li>Open the panel.</li>
                    <li>Choose an option.</li>
                    <li>Press save.</li>
                </PaperTextList>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperTextList ordered spacing="compact">
    <li>Open the panel.</li>
    <li>Choose an option.</li>
    <li>Press save.</li>
</PaperTextList>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="hint-list">Notes in the hint style</PaperText>
            <PaperText preset="body" as="p">
                Setting <PaperCode>preset</PaperCode> on the list styles every item at once.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperTextList preset="hint">
                    <li>Notes are subdued.</li>
                    <PaperTextList.Item color="danger">One item sets its own color.</PaperTextList.Item>
                </PaperTextList>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperTextList preset="hint">
    <li>Notes are subdued.</li>
    <PaperTextList.Item color="danger">One item sets its own color.</PaperTextList.Item>
</PaperTextList>`}
            </PaperCode>
        </PaperFlex>
    );
}
