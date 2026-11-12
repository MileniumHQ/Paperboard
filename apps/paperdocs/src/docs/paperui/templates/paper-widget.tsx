import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperWidget,
    PaperWidgetDot,
    PaperWidgetMessage,
    PaperWidgetRows,
    PaperWidgetStat,
    PaperWidgetStats,
} from "@mileniumhq/paperui";

export default function PaperWidgetDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperWidget</PaperText>
            <PaperText preset="body" as="p">
                PaperWidget is the tile layout of a Home widget: a header, a body, and an optional footer, all aligned to one left edge.
                Use it, with PaperWidgetStat, PaperWidgetRows, and PaperWidgetMessage for the body, in every widget a panel registers, so widgets from different panels line up on Home.
                It fills its tile and sizes its type and spacing from the tile, so one widget reads the same in a small cell and a large one.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Render PaperWidget as the root of the widget, inside a <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>.
                It is absolutely positioned and fills the nearest positioned ancestor, which in a widget page is the tile.
                The registration side of a widget is in <PaperLink href="/docs/paperapi/widgets/">PaperAPI widgets</PaperLink> and the walkthrough is in <PaperLink href="/docs/developers/widgets/">Widgets</PaperLink>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex width="panel-small" height="panel-height-small">
                    <PaperWidget title="Title" icon="bolt" detail="Detail">
                        <PaperWidgetStat value="42" caption="Caption" />
                    </PaperWidget>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperProvider, PaperWidget, PaperWidgetStat } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";

export function Widget() {
    return (
        <PaperProvider fullWidth fullHeight>
            <PaperWidget title="Title" icon="bolt" detail="Detail">
                <PaperWidgetStat value="42" caption="Caption" />
            </PaperWidget>
        </PaperProvider>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="widget-props">PaperWidget</PaperText>
            <PaperText preset="body" as="p">
                Extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without the native <PaperCode>title</PaperCode>.
                Children are the body.
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
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>The header's title, bold. A title too long for the tile wraps to a second line and is only ellipsized after that. Omit it only for a widget that is a face, such as a clock: with no title, detail, or action the header is not drawn.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A Material Symbols name, or an element, before the title. Drawn only when the header is. Hidden in a tile narrower than 150 pixels.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detail</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Muted text at the header's end, such as a count, a unit, or a time. It shrinks before the title does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>action</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>One compact control at the header's end, after the detail, such as a tiny icon button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>footer</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The bottom row on the tile's bottom edge: meta text on the left, actions on the right.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onPress</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Makes the whole tile one button, for a one-cell widget with no room in its header for a control. Controls inside the tile still work on their own.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pressLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The pressable tile's accessible name and tooltip. Set it with <PaperCode>onPress</PaperCode>: the tile has no other name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pressDisabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables the tile button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="stat-props">PaperWidgetStat and PaperWidgetStats</PaperText>
            <PaperText preset="body" as="p">
                PaperWidgetStat is the figure a widget is about: large, left-aligned, sized by the tile.
                It extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                PaperWidgetStats puts several stats side by side, sharing the width equally, and accepts the same HTML attributes.
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
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>Required</td>
                        <td>The figure. A value too wide for its column wraps to a second line instead of being cut.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>caption</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A line under the value saying what it is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tone</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default (text color)</td>
                        <td>Colors the value with a <PaperLink href="/docs/paperui/colors/">color role</PaperLink>: <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, and the others.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>meter</PaperCode></td>
                        <td><PaperCode>{"{ value: number; max: number; variant?: PaperRole }"}</PaperCode></td>
                        <td>No default (no bar)</td>
                        <td>Draws a <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink> bar under the caption. <PaperCode>variant</PaperCode> defaults to the stat's <PaperCode>tone</PaperCode>, then <PaperCode>"primary"</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="rows-props">PaperWidgetRows</PaperText>
            <PaperText preset="body" as="p">
                A list of rows, each a status dot, a label, and a detail. It extends <PaperCode>JSX.HTMLAttributes&lt;HTMLUListElement&gt;</PaperCode> without <PaperCode>children</PaperCode>.
                Rows that do not fit the tile are left out whole, never cut in half.
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
                        <td><PaperCode>rows</PaperCode></td>
                        <td><PaperCode>PaperWidgetRow[]</PaperCode></td>
                        <td>Required</td>
                        <td>The rows, in order.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Each <PaperCode>PaperWidgetRow</PaperCode> is an object:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>A stable identity for the row.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>Required</td>
                        <td>The row's text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detail</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Text at the row's end.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tone</PaperCode></td>
                        <td><PaperCode>PaperRole | "none"</PaperCode></td>
                        <td>No default (no dot)</td>
                        <td>A status dot before the label, in the role's color. <PaperCode>"none"</PaperCode> draws a hollow dot.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClick</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default (not clickable)</td>
                        <td>Makes the row a button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ariaLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The accessible name of a clickable row.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="message-props">PaperWidgetMessage and PaperWidgetDot</PaperText>
            <PaperText preset="body" as="p">
                PaperWidgetMessage shows a loading, empty, or failed state in the body where the content would be.
                Its children are the way out: Retry, Open, or Start buttons.
                It extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without the native <PaperCode>title</PaperCode>.
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
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>Required</td>
                        <td>What is happening, in a few words. It wraps to a second line before it is cut.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Why, or what to do.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tone</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default (neutral)</td>
                        <td><PaperCode>danger</PaperCode> and <PaperCode>warning</PaperCode> mark a failure and set <PaperCode>role="alert"</PaperCode>. Omit it for an empty or loading state, which gets <PaperCode>role="status"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>hint</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The full reason as a tooltip, for a tile too small to show a description.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                PaperWidgetDot draws a status dot alone, for a header or a footer line. It takes <PaperCode>tone?: PaperRole | "none"</PaperCode> (default <PaperCode>"none"</PaperCode>, a hollow dot) and <PaperCode>class</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The widget sizes from its tile, not the window. Padding is one gap at every size and the gaps between parts scale with the tile.</li>
                <li>Text wraps before it is cut: titles, stat values, and message titles take up to two lines. A detail, a caption, and a row stay on one line and are ellipsized, so rows keep an even height.</li>
                <li>Without <PaperCode>onPress</PaperCode>, the body keeps its own clicks, hovers, and scroll. With it, a button fills the tile behind the content and presses fall through to it, except on buttons, links, and fields inside the tile.</li>
                <li>A widget is its own document and has no access to the panel's state. Read it through the panel bridge and show the failure in the tile with PaperWidgetMessage, as the create-panel template does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="stats">Stats with a meter</PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex width="panel-small" height="panel-height-small">
                    <PaperWidget title="Memory" icon="memory" detail="8 GB" footer={<PaperText preset="caption">Updated now</PaperText>}>
                        <PaperWidgetStats>
                            <PaperWidgetStat value="62%" caption="Used" tone="warning" meter={{ value: 62, max: 100 }} />
                            <PaperWidgetStat value="3 GB" caption="Free" />
                        </PaperWidgetStats>
                    </PaperWidget>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperText, PaperWidget, PaperWidgetStat, PaperWidgetStats } from "@mileniumhq/paperui";

<PaperWidget title="Memory" icon="memory" detail="8 GB" footer={<PaperText preset="caption">Updated now</PaperText>}>
    <PaperWidgetStats>
        <PaperWidgetStat value="62%" caption="Used" tone="warning" meter={{ value: 62, max: 100 }} />
        <PaperWidgetStat value="3 GB" caption="Free" />
    </PaperWidgetStats>
</PaperWidget>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="rows">Rows with status dots</PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex width="panel-small" height="panel-height-small">
                    <PaperWidget title="Servers" icon="dns" detail="2 of 3">
                        <PaperWidgetRows
                            rows={[
                                { id: "a", label: "Server A", detail: "Running", tone: "success" },
                                { id: "b", label: "Server B", detail: "Stopped", tone: "danger" },
                                { id: "c", label: "Server C", detail: "Idle", tone: "none" },
                            ]}
                        />
                    </PaperWidget>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperWidget, PaperWidgetRows } from "@mileniumhq/paperui";

<PaperWidget title="Servers" icon="dns" detail="2 of 3">
    <PaperWidgetRows
        rows={[
            { id: "a", label: "Server A", detail: "Running", tone: "success" },
            { id: "b", label: "Server B", detail: "Stopped", tone: "danger" },
            { id: "c", label: "Server C", detail: "Idle", tone: "none" },
        ]}
    />
</PaperWidget>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="pressable">A tile that opens the panel</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>onPress</PaperCode> and <PaperCode>pressLabel</PaperCode> to make the whole tile one button.
                The <PaperCode>WidgetContext</PaperCode> that <PaperCode>defineWidgets</PaperCode> hands your mount function has an <PaperCode>openPanel()</PaperCode> for it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperWidget, PaperWidgetStat } from "@mileniumhq/paperui";
import type { WidgetContext } from "@mileniumhq/paperapi";

export function Greetings(props: { widget: WidgetContext; count: number }) {
    return (
        <PaperWidget
            title="Greetings"
            icon="waving_hand"
            onPress={() => props.widget.openPanel()}
            pressLabel="Open the panel"
        >
            <PaperWidgetStat value={props.count} caption="greetings" />
        </PaperWidget>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="failure">A failed state with a way out</PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex width="panel-small" height="panel-height-small">
                    <PaperWidget title="Status" icon="cloud" action={<PaperWidgetDot tone="danger" />}>
                        <PaperWidgetMessage title="Not answering" tone="danger" hint="The service did not respond">
                            <PaperButton size="tiny">Retry</PaperButton>
                        </PaperWidgetMessage>
                    </PaperWidget>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperWidget, PaperWidgetDot, PaperWidgetMessage } from "@mileniumhq/paperui";

<PaperWidget title="Status" icon="cloud" action={<PaperWidgetDot tone="danger" />}>
    <PaperWidgetMessage title="Not answering" tone="danger" hint="The service did not respond">
        <PaperButton size="tiny">Retry</PaperButton>
    </PaperWidgetMessage>
</PaperWidget>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A stat tile inside a panel page, not on Home, is <PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink>.</li>
                <li>A list inside a panel page is <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>.</li>
                <li>The registration of a widget, its sizes and its choices are in <PaperLink href="/docs/paperapi/widgets/">defineWidgets</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
