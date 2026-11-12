import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperRail,
    PaperRailAction,
    PaperRailItem,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperRailDoc() {
    const [view, setView] = createSignal<string | number>("home");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperRail</PaperText>
            <PaperText preset="body" as="p">
                PaperRail is a narrow vertical strip of icon buttons where one is selected, with optional labels under the icons.
                Use it for switching between a few categories or tools beside a larger area, when a full-width sidebar would take too much room.
                For a sidebar of text entries with descriptions and sections, use <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>name</PaperCode> is required.
                Give each <PaperCode>PaperRailItem</PaperCode> a unique <PaperCode>value</PaperCode>, an <PaperCode>icon</PaperCode>, and a string <PaperCode>label</PaperCode>, which names it for assistive technology.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperRail name="docs-rail" value={view()} onValueChange={setView}>
                    <PaperRailItem value="home" icon="home" label="Home" />
                    <PaperRailItem value="search" icon="search" label="Search" />
                    <PaperRailItem value="settings" icon="settings" label="Settings" />
                    <PaperRailItem value="locked" icon="lock" label="Locked" disabled />
                </PaperRail>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperRail, PaperRailItem } from "@mileniumhq/paperui";

export function Example() {
    const [view, setView] = createSignal<string | number>("home");

    return (
        <PaperRail name="docs-rail" value={view()} onValueChange={setView}>
            <PaperRailItem value="home" icon="home" label="Home" />
            <PaperRailItem value="search" icon="search" label="Search" />
            <PaperRailItem value="settings" icon="settings" label="Settings" />
            <PaperRailItem value="locked" icon="lock" label="Locked" disabled />
        </PaperRail>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="rail-props">PaperRail</PaperText>
            <PaperText preset="body" as="p">
                PaperRailProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the rail's <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>Identifies the group of items. Use a distinct name for each rail on a page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default</td>
                        <td>The selected item's <PaperCode>value</PaperCode>. Setting it makes the rail controlled: it changes only when you change it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (none selected)</td>
                        <td>The starting item of an uncontrolled rail.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the chosen item's <PaperCode>value</PaperCode>, even when it was already selected.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showLabels</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Draws each item's <PaperCode>label</PaperCode> under its icon, in wider items. An item's own <PaperCode>showLabel</PaperCode> wins.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onReorder</PaperCode></td>
                        <td><PaperCode>(newOrderValues: string[]) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called after a drag with the <PaperCode>reorderable</PaperCode> items' values in their new order. See <PaperLink href="#reordering">Reordering</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the rail.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperRailItem</PaperText>
            <PaperText preset="body" as="p">
                PaperRailItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
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
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The item's identity, compared with the rail's <PaperCode>value</PaperCode>. Keep it unique within the rail.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>A string is a Material icon name. An element is drawn in the icon's place, such as a <PaperLink href="/docs/paperui/papericon/">PaperIcon</PaperLink> with an image.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>The item's name. A string label also becomes the item's tooltip and <PaperCode>aria-label</PaperCode>, unless you pass <PaperCode>title</PaperCode> or <PaperCode>aria-label</PaperCode> yourself. An element label is only drawn when labels are shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showLabel</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>The rail's <PaperCode>showLabels</PaperCode></td>
                        <td>Draws this item's label under its icon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the item, ignores choosing, and removes it from the tab order.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reorderable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Lets the item be dragged among the rail's other reorderable items: at once with a mouse or pen, after a hold with a finger.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClick</PaperCode></td>
                        <td>Click handler</td>
                        <td>No default</td>
                        <td>Runs after the item is chosen. Not called when disabled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onKeyDown</PaperCode></td>
                        <td>Key handler</td>
                        <td>No default</td>
                        <td>Runs after the item handles Enter and Space.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the item.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="action-props">PaperRailAction</PaperText>
            <PaperText preset="body" as="p">
                PaperRailAction is a button that looks like a rail item but is never selected, for a command that sits in the rail, such as Add.
                Its props extend <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode>, so <PaperCode>onClick</PaperCode> and <PaperCode>disabled</PaperCode> work as on a button.
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
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string label is the default tooltip and the default <PaperCode>aria-label</PaperCode>. A <PaperCode>title</PaperCode> or <PaperCode>aria-label</PaperCode> you pass wins. Pass <PaperCode>aria-label</PaperCode> yourself for an element label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showLabel</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>The rail's <PaperCode>showLabels</PaperCode></td>
                        <td>Draws the label under the icon.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="selection">Selecting an item</PaperText>
            <PaperTextList>
                <li>A click, or Enter or Space on a focused item, selects it and calls <PaperCode>onValueChange</PaperCode>. The selected item draws a primary outline and a primary icon.</li>
                <li>Controlled and uncontrolled work as in a form: with <PaperCode>value</PaperCode> set, the selection changes only when your signal does.</li>
                <li>The rail is a fit-content column with a right divider and a raised surface. It grows with its items and does not scroll by itself: place it in a container that scrolls.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="reordering">Reordering</PaperText>
            <PaperTextList>
                <li>Mark the items that may move with <PaperCode>reorderable</PaperCode>. They move only among each other, so fixed items such as Home and Settings stay where they are. Keep the reorderable items next to each other.</li>
                <li>Press a reorderable item with the primary mouse button or a pen and drag it up or down. A drag starts after 6 pixels of movement; shorter movement is a click.</li>
                <li>A finger holds the item still for half a second first, and the item lifts. Moving sooner scrolls the rail instead. The hold is the same one that opens the item's context menu: let go and the menu stays open, move and the menu closes as the item follows the finger.</li>
                <li>On drop, the rail's <PaperCode>onReorder</PaperCode> gets the reorderable items' values in their new order, as strings. The rail does not reorder its own children: reorder your data, and the items follow.</li>
                <li>A drop where the drag began does not call <PaperCode>onReorder</PaperCode>. The click that ends a drag does not select the item.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li>Each item is a <PaperCode>div</PaperCode> with <PaperCode>role="radio"</PaperCode> and <PaperCode>aria-checked</PaperCode>. The rail itself has no role.</li>
                <li>Every enabled item is a tab stop. The arrow keys do not move between items.</li>
                <li>A string icon is hidden from assistive technology. The name comes from a string <PaperCode>label</PaperCode>, so always pass one, even when labels are not shown.</li>
                <li>An item with an element label and no string label has no accessible name.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="labels">Rail with labels</PaperText>
            <PaperText preset="body" as="p">
                The Blocks panel's block library is a rail of categories with <PaperCode>showLabels</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperRail name="docs-rail-labels" showLabels defaultValue="home">
                    <PaperRailItem value="home" icon="home" label="Home" />
                    <PaperRailItem value="files" icon="folder" label="Files" />
                    <PaperRailAction icon="add" label="Add" onClick={() => undefined} />
                </PaperRail>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperRail, PaperRailAction, PaperRailItem } from "@mileniumhq/paperui";

<PaperRail name="docs-rail-labels" showLabels defaultValue="home">
    <PaperRailItem value="home" icon="home" label="Home" />
    <PaperRailItem value="files" icon="folder" label="Files" />
    <PaperRailAction icon="add" label="Add" onClick={() => undefined} />
</PaperRail>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Entries with text, descriptions, or sections belong in <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink>.</li>
                <li>A choice inside a page, as cards or a list, is <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
