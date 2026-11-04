import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCard</PaperText>
            <PaperText preset="body" as="p">
                PaperCard is the bordered, rounded, clipped surface that groups content in a panel.
                Use it for every boxed section, from a settings group to a danger zone.
                It takes the same spacing tokens as PaperFlex and the shared layout props.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>padding</PaperCode> and <PaperCode>gap</PaperCode> to spacing tokens.
                A card lays its children out in a column and fills the width of its parent.
            </PaperText>
            <PaperCard data-docs-demo padding="double" gap="full" surface="front">
                <PaperText preset="title" as="p">Card</PaperText>
                <PaperText preset="body" as="p">Content sits inside the padding.</PaperText>
                <PaperButton>Button</PaperButton>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" gap="full" surface="front">
            <PaperText preset="title" as="p">Card</PaperText>
            <PaperText preset="body" as="p">Content sits inside the padding.</PaperText>
            <PaperButton>Button</PaperButton>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCardProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> and <PaperCode>PaperLayoutProps</PaperCode>.
                Other props, such as <PaperCode>id</PaperCode>, <PaperCode>role</PaperCode>, and event handlers, land on the root <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>surface</PaperCode></td>
                        <td><PaperCode>PaperCardSurface</PaperCode></td>
                        <td>No default</td>
                        <td>Background tone: <PaperCode>"front"</PaperCode>, <PaperCode>"frontest"</PaperCode>, <PaperCode>"back"</PaperCode>, <PaperCode>"element"</PaperCode>, or <PaperCode>"transparent"</PaperCode>. Without it the card draws <PaperCode>front</PaperCode>, the standard card; <PaperCode>front</PaperCode> is the standard card, <PaperCode>frontest</PaperCode> sits above it, <PaperCode>back</PaperCode> below it, <PaperCode>element</PaperCode> is the control tone, and <PaperCode>transparent</PaperCode> keeps the border without a fill.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>padding</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default (no padding)</td>
                        <td>Inner padding on all sides.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paddingX</PaperCode>, <PaperCode>paddingY</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default</td>
                        <td>Horizontal and vertical padding. Each overrides <PaperCode>padding</PaperCode> on its axis.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>gap</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default (no gap)</td>
                        <td>Space between children.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>borderless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Removes the border and keeps the fill.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>plain</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Removes the border and the fill. The card only rounds and clips its content.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>accent</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default</td>
                        <td>Tints the surface and border with a role color, such as <PaperCode>danger</PaperCode> for a danger zone. Roles: <PaperCode>primary</PaperCode>, <PaperCode>brand</PaperCode>, <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root. An object <PaperCode>style</PaperCode> is merged last.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="spacing">Spacing values</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>PaperSpacing</PaperCode> is a token name, a number, or a CSS length.
                Prefer a token: <PaperCode>none</PaperCode> (0), <PaperCode>onefourth</PaperCode>, <PaperCode>half</PaperCode>, <PaperCode>threefourths</PaperCode>, <PaperCode>full</PaperCode> (<PaperCode>--paper-uigap</PaperCode>, 12 pixels), <PaperCode>sixfourths</PaperCode>, <PaperCode>double</PaperCode>, <PaperCode>triple</PaperCode>, <PaperCode>quadruple</PaperCode>, and <PaperCode>inset</PaperCode>.
                A number means pixels.
                A string ending in <PaperCode>px</PaperCode>, <PaperCode>rem</PaperCode>, or <PaperCode>%</PaperCode>, or starting with <PaperCode>var(</PaperCode> or <PaperCode>calc(</PaperCode>, is used as written.
                Any other string is read as a PaperUI token name.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="layout-props">Layout props</PaperText>
            <PaperText preset="body" as="p">
                The shared layout props also work on a card, the same as on <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>flex</PaperCode></td>
                        <td><PaperCode>boolean | number | CSS flex</PaperCode></td>
                        <td><PaperCode>true</PaperCode> is <PaperCode>1 1 0%</PaperCode>, <PaperCode>false</PaperCode> is <PaperCode>none</PaperCode>, a number is <PaperCode>n n 0%</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>grow</PaperCode>, <PaperCode>shrink</PaperCode></td>
                        <td><PaperCode>boolean | number</PaperCode></td>
                        <td>Sets <PaperCode>flex-grow</PaperCode> and <PaperCode>flex-shrink</PaperCode>. A card is <PaperCode>flex-shrink: 0</PaperCode> by default so siblings do not crush it; <PaperCode>grow</PaperCode> alone also lets it shrink.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>width</PaperCode>, <PaperCode>height</PaperCode></td>
                        <td><PaperCode>PaperSize</PaperCode></td>
                        <td>A fixed size, always a size token such as <PaperCode>"panel-small"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>minWidth</PaperCode>, <PaperCode>minHeight</PaperCode></td>
                        <td><PaperCode>PaperSize | string | number</PaperCode></td>
                        <td>Size tokens or lengths. <PaperCode>0</PaperCode> lets a flex child shrink below its content.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>maxWidth</PaperCode>, <PaperCode>maxHeight</PaperCode></td>
                        <td><PaperCode>PaperSize | string | number</PaperCode></td>
                        <td>Size tokens or lengths. <PaperCode>0</PaperCode> lets a flex child shrink below its content.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode>, <PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode> fills the parent. <PaperCode>false</PaperCode> sizes to content, overriding the card's default full width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean | "x" | "y"</PaperCode></td>
                        <td>Makes the card scroll on one or both axes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>overflow</PaperCode>, <PaperCode>overflowX</PaperCode>, <PaperCode>overflowY</PaperCode></td>
                        <td>CSS overflow</td>
                        <td>Sets the overflow directly.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A card clips its content, so a child's shadow or an absolutely positioned popover is cut at the border. Render popovers through their own portal, as PaperUI menus do.</li>
                <li>Without <PaperCode>scrollable</PaperCode> or <PaperCode>overflow</PaperCode>, content taller than a height-limited card is clipped, not scrolled.</li>
                <li>The card is a plain <PaperCode>div</PaperCode> with no role. Add <PaperCode>role</PaperCode> and <PaperCode>aria-label</PaperCode> when it is a landmark or a group.</li>
                <li>A card does not render a title. Put a heading inside it, or use <PaperLink href="/docs/paperui/papersectionheader/">PaperSectionHeader</PaperLink> above it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="surfaces">Surfaces</PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex direction="row" gap="full" wrap>
                    <PaperCard padding="full" surface="front"><PaperText preset="body" as="p">front</PaperText></PaperCard>
                    <PaperCard padding="full" surface="frontest"><PaperText preset="body" as="p">frontest</PaperText></PaperCard>
                    <PaperCard padding="full" surface="back"><PaperText preset="body" as="p">back</PaperText></PaperCard>
                    <PaperCard padding="full" surface="element"><PaperText preset="body" as="p">element</PaperText></PaperCard>
                    <PaperCard padding="full" surface="transparent"><PaperText preset="body" as="p">transparent</PaperText></PaperCard>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" wrap>
    <PaperCard padding="full" surface="front"><PaperText preset="body" as="p">front</PaperText></PaperCard>
    <PaperCard padding="full" surface="frontest"><PaperText preset="body" as="p">frontest</PaperText></PaperCard>
    <PaperCard padding="full" surface="back"><PaperText preset="body" as="p">back</PaperText></PaperCard>
    <PaperCard padding="full" surface="element"><PaperText preset="body" as="p">element</PaperText></PaperCard>
    <PaperCard padding="full" surface="transparent"><PaperText preset="body" as="p">transparent</PaperText></PaperCard>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="danger-zone">Danger zone</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperCard accent="danger" padding="double" gap="full">
                    <PaperText preset="title" as="p">Delete everything</PaperText>
                    <PaperText preset="body" as="p">This cannot be undone.</PaperText>
                    <PaperButton variant="danger">Delete</PaperButton>
                </PaperCard>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperCard accent="danger" padding="double" gap="full">
    <PaperText preset="title" as="p">Delete everything</PaperText>
    <PaperText preset="body" as="p">This cannot be undone.</PaperText>
    <PaperButton variant="danger">Delete</PaperButton>
</PaperCard>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="scrolling">A scrolling list card</PaperText>
            <PaperText preset="body" as="p">
                Limit the height with <PaperCode>maxHeight</PaperCode> and turn on <PaperCode>scrollable="y"</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { For } from "solid-js";
import { PaperCard, PaperText } from "@mileniumhq/paperui";

export function Lines(props: { lines: string[] }) {
    return (
        <PaperCard padding="full" maxHeight="panel-height-small" scrollable="y">
            <For each={props.lines}>
                {(line) => <PaperText preset="body" as="p">{line}</PaperText>}
            </For>
        </PaperCard>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
