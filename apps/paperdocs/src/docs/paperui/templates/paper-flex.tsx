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

export default function PaperFlexDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperFlex</PaperText>
            <PaperText preset="body" as="p">
                PaperFlex is a flexbox container whose gap, padding, alignment and size are props with token values.
                Use it for every row or column in a panel instead of writing a layout class.
                It lays out; for a bordered surface use <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The default direction is a column.
                Set <PaperCode>direction="row"</PaperCode> for a row and name the gap with a spacing token.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="row" gap="half" align="center" wrap>
                        <PaperButton variant="primary">Save</PaperButton>
                        <PaperButton>Cancel</PaperButton>
                        <PaperFlex flex />
                        <PaperButton variant="danger">Delete</PaperButton>
                    </PaperFlex>
                    <PaperFlex center background="surface-inset" padding="double">
                        <PaperText preset="hint">Centered on both axes</PaperText>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="full">
            <PaperFlex direction="row" gap="half" align="center" wrap>
                <PaperButton variant="primary">Save</PaperButton>
                <PaperButton>Cancel</PaperButton>
                <PaperFlex flex />
                <PaperButton variant="danger">Delete</PaperButton>
            </PaperFlex>
            <PaperFlex center background="surface-inset" padding="double">
                <PaperText preset="hint">Centered on both axes</PaperText>
            </PaperFlex>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperFlexProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> (without <PaperCode>onResize</PaperCode>) and the shared layout props.
                Other props, such as <PaperCode>id</PaperCode>, <PaperCode>role</PaperCode> and <PaperCode>aria-*</PaperCode>, land on the <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"row"</PaperCode>, <PaperCode>"column"</PaperCode>, <PaperCode>"row-reverse"</PaperCode>, or <PaperCode>"column-reverse"</PaperCode></td>
                        <td><PaperCode>"column"</PaperCode></td>
                        <td>The main axis. Also what <PaperCode>resizable</PaperCode> resizes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>gap</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default (no gap)</td>
                        <td>Space between children. A spacing token such as <PaperCode>"half"</PaperCode> or <PaperCode>"double"</PaperCode>. See <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>padding</PaperCode>, <PaperCode>paddingX</PaperCode>, <PaperCode>paddingY</PaperCode></td>
                        <td><PaperCode>PaperSpacing</PaperCode></td>
                        <td>No default (none)</td>
                        <td>Inner space on all sides, left and right, or top and bottom. The axis props win over <PaperCode>padding</PaperCode> on their sides.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>align</PaperCode></td>
                        <td>CSS <PaperCode>align-items</PaperCode></td>
                        <td>No default (stretch)</td>
                        <td>Cross-axis alignment, such as <PaperCode>"center"</PaperCode> or <PaperCode>"start"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>justify</PaperCode></td>
                        <td>CSS <PaperCode>justify-content</PaperCode></td>
                        <td>No default (start)</td>
                        <td>Main-axis distribution, such as <PaperCode>"space-between"</PaperCode> or <PaperCode>"flex-end"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>center</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Centers children on both axes. <PaperCode>align</PaperCode> and <PaperCode>justify</PaperCode> win when set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>wrap</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode> or CSS <PaperCode>flex-wrap</PaperCode></td>
                        <td>No default (no wrap)</td>
                        <td><PaperCode>true</PaperCode> is <PaperCode>wrap</PaperCode>. A string passes through.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>background</PaperCode></td>
                        <td><PaperCode>PaperBackgroundSurface</PaperCode> or any CSS value</td>
                        <td>No default (transparent)</td>
                        <td>A surface token such as <PaperCode>"surface-inset"</PaperCode>. See <PaperLink href="/docs/paperui/surfaces/">Surfaces and borders</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resizable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Adds a drag handle on the trailing edge. See Behavior.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onResize</PaperCode></td>
                        <td><PaperCode>(size) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called on every drag step with <PaperCode>{`{ width?: number; height?: number }`}</PaperCode>: <PaperCode>width</PaperCode> for a row and <PaperCode>height</PaperCode> for a column, in pixels.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>hidden</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (shown)</td>
                        <td>Hides the container with <PaperCode>display: none</PaperCode>, as it would any element.</td>
                    </tr>
                    <tr>
                        <td>Layout props</td>
                        <td><PaperCode>PaperLayoutProps</PaperCode></td>
                        <td>No default</td>
                        <td>Size and flex behavior inside the parent. Every one is described in <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>. The props are flex, grow, shrink, width, height, minWidth, minHeight, maxWidth, maxHeight, fullWidth, fullHeight, scrollable, overflow, overflowX, overflowY.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element. An object <PaperCode>style</PaperCode> is merged last and overrides the props above.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="sizing">Sizing</PaperText>
            <PaperTextList>
                <li>A PaperFlex is <PaperCode>display: flex</PaperCode> and sizes to its parent's flow like any block. Add <PaperCode>fullWidth</PaperCode> or <PaperCode>fullHeight</PaperCode> to fill the parent, or <PaperCode>flex</PaperCode> to take the leftover space in a flex parent.</li>
                <li><PaperCode>flex</PaperCode> on an empty PaperFlex is a spacer that pushes the siblings after it to the end, as the Usage sample does.</li>
                <li>A flex child that holds a long line or a scroller needs <PaperCode>minWidth={`{0}`}</PaperCode> to shrink below its content.</li>
                <li><PaperCode>scrollable</PaperCode> only scrolls when the container has a bounded size, such as <PaperCode>fullHeight</PaperCode> inside a bounded parent.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="resizable">Resizable</PaperText>
            <PaperTextList>
                <li>The handle sits on the trailing edge: right for <PaperCode>row</PaperCode>, bottom for <PaperCode>column</PaperCode>, and the leading edge for the reverse directions.</li>
                <li>Dragging writes an inline <PaperCode>width</PaperCode> (row) or <PaperCode>height</PaperCode> (column) in pixels. A <PaperCode>width</PaperCode>, <PaperCode>height</PaperCode>, <PaperCode>fullWidth</PaperCode> or <PaperCode>fullHeight</PaperCode> prop on the same element is written after it and wins, so leave those off a resizable container.</li>
                <li>The drag is clamped to the element's computed <PaperCode>min-width</PaperCode> and <PaperCode>max-width</PaperCode> (or heights). Without them it stays between 160px and 80% of the window width (100px and 80% of the height).</li>
                <li>The handle works with mouse, pen and touch.</li>
                <li>The size is not remembered. Save the value from <PaperCode>onResize</PaperCode> if the panel should restore it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="context">Layout context</PaperText>
            <PaperText preset="body" as="p">
                PaperFlex gives its children a layout context holding its direction.{" "}
                <PaperCode>usePaperLayout()</PaperCode> reads it. See <PaperLink href="/docs/paperui/utilities/">Utilities</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="toolbar">Toolbar with a trailing action</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" align="center" justify="space-between" wrap gap="half">
                    <PaperText preset="label">Title</PaperText>
                    <PaperButton variant="primary" size="small">Action</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" align="center" justify="space-between" wrap gap="half">
    <PaperText preset="label">Title</PaperText>
    <PaperButton variant="primary" size="small">Action</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="wrapping-row">Wrapping row of buttons</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="half" wrap>
                    <PaperButton>One</PaperButton>
                    <PaperButton>Two</PaperButton>
                    <PaperButton>Three</PaperButton>
                    <PaperButton>Four</PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="half" wrap>
    <PaperButton>One</PaperButton>
    <PaperButton>Two</PaperButton>
    <PaperButton>Three</PaperButton>
    <PaperButton>Four</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="resizable-pane">Resizable side pane</PaperText>
            <PaperText preset="body" as="p">
                Give the pane a floor and a ceiling with size tokens and let the handle move it between them.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Panes() {
    const [width, setWidth] = createSignal(0);

    return (
        <PaperFlex direction="row" fullWidth>
            <PaperFlex
                direction="row"
                resizable
                minWidth="field"
                maxWidth="panel"
                background="surface-inset"
                padding="full"
                onResize={(size) => setWidth(size.width ?? 0)}
            >
                <PaperText>{width()}px</PaperText>
            </PaperFlex>
            <PaperFlex flex padding="full">
                <PaperText>Main</PaperText>
            </PaperFlex>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A bordered, rounded container is <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>.</li>
                <li>A responsive grid of equal tiles is <PaperLink href="/docs/paperui/papergrid/">PaperGrid</PaperLink>.</li>
                <li>A fixed gap with nothing else is <PaperLink href="/docs/paperui/paperspacer/">PaperSpacer</PaperLink>.</li>
                <li>A list pane beside a detail pane that collapses on narrow windows is <PaperLink href="/docs/paperui/papersplit/">PaperSplit</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
