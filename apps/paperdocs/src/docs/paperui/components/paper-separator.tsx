import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSeparatorDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSeparator</PaperText>
            <PaperText preset="body" as="p">
                PaperSeparator is a thin divider line, horizontal between blocks or vertical between inline items.
                Use it to split groups of content or actions that sit in the same container.
                To label the groups instead of only splitting them, use <PaperLink href="/docs/paperui/papersectionheader/">PaperSectionHeader</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                With no props the separator is a horizontal rule across its container.
                Add <PaperCode>role="separator"</PaperCode> when the line carries meaning for assistive technology.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body" as="p">Above</PaperText>
                    <PaperSeparator role="separator" />
                    <PaperText preset="body" as="p">Below</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperSeparator, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="full">
            <PaperText preset="body" as="p">Above</PaperText>
            <PaperSeparator role="separator" />
            <PaperText preset="body" as="p">Below</PaperText>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperSeparatorProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLSpanElement&gt;</PaperCode>.
                Other props land on the separator's <PaperCode>span</PaperCode>.
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
                        <td><PaperCode>vertical</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (horizontal)</td>
                        <td>Draws a vertical line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode></td>
                        <td>The same choice as a value. <PaperCode>"vertical"</PaperCode> draws a vertical line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>orientation</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode></td>
                        <td>An alias of <PaperCode>direction</PaperCode>. The line is vertical when any of the three props asks for it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the separator.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A horizontal separator is a block the full width of its container, one border width thick, with a half gap above and below.</li>
                <li>A vertical separator is one border width wide and as tall as a small icon, centered on the cross axis of its row, with a half gap on each side. It fits between buttons or text in a <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink> row.</li>
                <li>The separator is an empty <PaperCode>span</PaperCode> with no role, so assistive technology ignores it unless you set <PaperCode>role="separator"</PaperCode>. Inside <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> and <PaperLink href="/docs/paperui/papermenubar/">PaperMenuBar</PaperLink> dropdowns, set it so the group split is announced.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="vertical">Between inline items</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" align="center" wrap>
                    <PaperButton variant="text">First</PaperButton>
                    <PaperSeparator vertical />
                    <PaperButton variant="text">Second</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" align="center" wrap>
    <PaperButton variant="text">First</PaperButton>
    <PaperSeparator vertical />
    <PaperButton variant="text">Second</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="menu-groups">Splitting a menu</PaperText>
            <PaperText preset="body" as="p">
                The Blocks panel puts a separator before the destructive item of its project menu.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperContextMenuItem, PaperSeparator } from "@mileniumhq/paperui";

<PaperContextMenuItem icon="edit" onClick={() => undefined}>Rename</PaperContextMenuItem>
<PaperSeparator role="separator" />
<PaperContextMenuItem icon="delete" danger onClick={() => undefined}>Delete</PaperContextMenuItem>`}
            </PaperCode>
        </PaperFlex>
    );
}
