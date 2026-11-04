import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperList,
    PaperListItem,
    PaperListLabel,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperListDoc() {
    const [selected, setSelected] = createSignal("overview");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperList</PaperText>
            <PaperText preset="body" as="p">
                PaperList is a selectable list of rows, vertical like a sidebar or horizontal like a tab strip.
                Use it when the user picks an item to open, switches between tabs, or reorders and closes entries.
                Use <PaperLink href="/docs/paperui/paperkeyvaluelist/">PaperKeyValueList</PaperLink> for read-only label and value rows.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Give the list a <PaperCode>name</PaperCode>, bind <PaperCode>value</PaperCode> and <PaperCode>onValueChange</PaperCode>, and add a PaperListItem for each row.
                Each item has a <PaperCode>value</PaperCode> and its text as children.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperList
                    name="docs-list"
                    value={selected()}
                    onValueChange={(value) => setSelected(String(value))}
                    fullWidth
                    borderless
                >
                    <PaperListItem value="overview" icon="dashboard" description="Description">Overview</PaperListItem>
                    <PaperListItem value="players" icon="group">Players</PaperListItem>
                    <PaperListItem value="logs" icon="description">Logs</PaperListItem>
                    <PaperListItem value="locked" icon="lock" disabled>Disabled</PaperListItem>
                </PaperList>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperList, PaperListItem } from "@mileniumhq/paperui";

export function Example() {
    const [selected, setSelected] = createSignal("overview");

    return (
        <PaperCard surface="front">
            <PaperList
                name="docs-list"
                value={selected()}
                onValueChange={(value) => setSelected(String(value))}
                fullWidth
                borderless
            >
                <PaperListItem value="overview" icon="dashboard" description="Description">Overview</PaperListItem>
                <PaperListItem value="players" icon="group">Players</PaperListItem>
                <PaperListItem value="logs" icon="description">Logs</PaperListItem>
                <PaperListItem value="locked" icon="lock" disabled>Disabled</PaperListItem>
            </PaperList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="list-props">PaperList</PaperText>
            <PaperText preset="body" as="p">
                PaperListProps is the selection props plus <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>div</PaperCode>.
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
                        <td>Required, no default</td>
                        <td>Names the group of native inputs inside the items. Use a name that is unique on the page: two lists with one name share a radio group.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (uncontrolled)</td>
                        <td>The selected item's <PaperCode>value</PaperCode>. When set, you own the selection. Pass <PaperCode>""</PaperCode> for a controlled list with nothing selected.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (nothing selected)</td>
                        <td>Initial selection of an uncontrolled list.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(v: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the chosen item's value, with its original type. Not used when <PaperCode>multiple</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>multiple</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (single)</td>
                        <td>Lets any number of items be selected; choosing a selected item unselects it. The items hold checkboxes instead of radios.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>values</PaperCode>, <PaperCode>defaultValues</PaperCode></td>
                        <td><PaperCode>readonly (string | number)[]</PaperCode></td>
                        <td>No default (empty)</td>
                        <td>The selection in multiple mode, controlled and uncontrolled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValuesChange</PaperCode></td>
                        <td><PaperCode>(v: (string | number)[]) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the new selection in multiple mode.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode> lays the items in a row, as a tab strip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Shorthand for <PaperCode>direction="horizontal"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reorderable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Lets the user drag items into a new order. See Reordering.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onReorder</PaperCode></td>
                        <td><PaperCode>(ids: (string | number)[]) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the new order of item values after a drop. The values are strings.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onBeforeItemClose</PaperCode></td>
                        <td>Close handler</td>
                        <td>No default</td>
                        <td>List-wide version of the item's <PaperCode>onBeforeClose</PaperCode>. Setting it, <PaperCode>onItemClose</PaperCode>, or <PaperCode>onItemClosed</PaperCode> gives every item a close button. See Closing items.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onItemClose</PaperCode></td>
                        <td>Close handler</td>
                        <td>No default</td>
                        <td>List-wide version of the item's <PaperCode>onClose</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onItemClosed</PaperCode></td>
                        <td><PaperCode>(v: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>List-wide version of the item's <PaperCode>onClosed</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>borderless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (right border)</td>
                        <td>Removes the list's right border.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>Fills the container's width. Without it a vertical list is <PaperCode>--paper-size-sidebar</PaperCode> (190 pixels) wide.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td><PaperCode>true</PaperCode> forces full height. A vertical list is full height already; a horizontal one is auto height.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flex</PaperCode></td>
                        <td><PaperCode>boolean | number | CSS flex</PaperCode></td>
                        <td>No default</td>
                        <td><PaperCode>true</PaperCode> is <PaperCode>1 1 0%</PaperCode>, <PaperCode>false</PaperCode> is <PaperCode>none</PaperCode>, a number is <PaperCode>n n 0%</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean | "x" | "y"</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>The list scrolls on its layout axis instead of squeezing its rows. <PaperCode>"x"</PaperCode> or <PaperCode>"y"</PaperCode> forces an axis. <PaperCode>false</PaperCode> turns scrolling off and lets rows shrink.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>background</PaperCode></td>
                        <td><PaperCode>PaperBackgroundSurface</PaperCode></td>
                        <td>No default</td>
                        <td>The list's surface: a background surface name or <PaperCode>"transparent"</PaperCode>. Without it the list uses <PaperCode>surface-inset</PaperCode>. Use <PaperCode>"surface-raised"</PaperCode> or <PaperCode>"transparent"</PaperCode> inside a card that already has a surface.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root. An object <PaperCode>style</PaperCode> is merged last.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperListItem</PaperText>
            <PaperText preset="body" as="p">
                PaperListItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLLabelElement&gt;</PaperCode> without <PaperCode>onClose</PaperCode>, which has a different signature here.
                An item must be a direct child of the PaperList.
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
                        <td>Required, no default</td>
                        <td>The item's identity, passed to <PaperCode>onValueChange</PaperCode> and compared with the list's <PaperCode>value</PaperCode>. Keep it unique in the list.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The item's title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Secondary text under the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A leading icon: a string is a Material icon name, an element such as a <PaperLink href="/docs/paperui/paperavatar/">PaperAvatar</PaperLink> is rendered as is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Trailing controls, such as a menu button. They sit inside the item's label, so each control must stop its own click and pointer events, or a press also selects the item.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the item and keeps it from being selected.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Adds a close button to the item. Setting <PaperCode>onBeforeClose</PaperCode>, <PaperCode>onClose</PaperCode>, or <PaperCode>onClosed</PaperCode> does too.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onBeforeClose</PaperCode></td>
                        <td>Close handler</td>
                        <td>No default</td>
                        <td>Runs first and is awaited. Return <PaperCode>false</PaperCode> or call <PaperCode>event.preventDefault()</PaperCode> to cancel the close.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td>Close handler</td>
                        <td>No default</td>
                        <td>Runs on every close click, even when a before handler cancelled it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClosed</PaperCode></td>
                        <td><PaperCode>(v: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Runs only when the close was not cancelled. Remove the item from your data here.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the item. An object <PaperCode>style</PaperCode> is merged after the drag offset.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The close handlers have these signatures. The list's <PaperCode>onBeforeItemClose</PaperCode>, <PaperCode>onItemClose</PaperCode>, and <PaperCode>onItemClosed</PaperCode> take the same ones.
            </PaperText>
            <PaperCode block language="ts">
{`onBeforeClose(event: PaperListItemCloseEvent): boolean | Promise<boolean> | void;
onClose(event: PaperListItemCloseEvent): void;
onClosed(value: string | number): void;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                PaperListItemCloseEvent is <PaperCode>{"{ value: string | number; nativeEvent: MouseEvent; preventDefault(): void; defaultPrevented: boolean }"}</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="label-props">PaperListLabel</PaperText>
            <PaperText preset="body" as="p">
                PaperListLabel is a small subtle heading between items that names the group below it.
                It takes PaperText props and children, and is not selectable.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="selection">Selection</PaperText>
            <PaperTextList>
                <li>Each item is a <PaperCode>label</PaperCode> around a visually hidden native radio input (a checkbox with <PaperCode>multiple</PaperCode>) that shares the list's <PaperCode>name</PaperCode>. Selection, focus, and form semantics are the browser's.</li>
                <li>A controlled list changes only when you change <PaperCode>value</PaperCode>. <PaperCode>onValueChange</PaperCode> reports the request.</li>
                <li>The selected item is marked with an accent bar. In a horizontal list the bar is along the bottom edge.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="reordering">Reordering</PaperText>
            <PaperTextList>
                <li>With <PaperCode>reorderable</PaperCode>, press an item with the primary button or a finger and drag it along the list's axis. A drag starts after 6 pixels of movement; shorter movement is a click.</li>
                <li>Items shift out of the way while you drag. On drop, <PaperCode>onReorder</PaperCode> gets the full new order. The list does not reorder its own children: reorder your data, and the items follow.</li>
                <li>The order is read from the DOM, so the values passed to <PaperCode>onReorder</PaperCode> are strings, even if the items' values are numbers. Convert them back when you look items up.</li>
                <li>Only items that are direct children take part. A drop that lands where the drag began does not call <PaperCode>onReorder</PaperCode>. The click that ends a drag is swallowed, so it does not select the item.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="closing">Closing items</PaperText>
            <PaperTextList>
                <li>The close button is a tiny icon button named <PaperCode>Close</PaperCode>. It does not remove anything: you remove the item from your data.</li>
                <li>Order of events for a click: the item's <PaperCode>onBeforeClose</PaperCode>, then the list's <PaperCode>onBeforeItemClose</PaperCode> (skipped if the item already cancelled), then the item's <PaperCode>onClose</PaperCode> and the list's <PaperCode>onItemClose</PaperCode>, then, if not cancelled, the item's <PaperCode>onClosed</PaperCode> and the list's <PaperCode>onItemClosed</PaperCode>.</li>
                <li>Use the before handler to confirm unsaved work: return <PaperCode>false</PaperCode> after the user declines.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="layout">Layout</PaperText>
            <PaperTextList>
                <li>Left alone, a vertical list is a sidebar: 190 pixels wide, full height, a right border, on the inset surface. Set <PaperCode>fullWidth</PaperCode> and <PaperCode>borderless</PaperCode> to use it inside a card, as the gameserver panel does.</li>
                <li>A horizontal list is full width and auto height, with no right border.</li>
                <li>A list scrolls rather than crushing its rows when it overflows.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="grouped">Groups with labels</PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperList name="docs-grouped" defaultValue="a" fullWidth borderless>
                    <PaperListLabel>Group</PaperListLabel>
                    <PaperListItem value="a">First</PaperListItem>
                    <PaperListItem value="b">Second</PaperListItem>
                    <PaperListLabel>Another group</PaperListLabel>
                    <PaperListItem value="c">Third</PaperListItem>
                </PaperList>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperList name="docs-grouped" defaultValue="a" fullWidth borderless>
    <PaperListLabel>Group</PaperListLabel>
    <PaperListItem value="a">First</PaperListItem>
    <PaperListItem value="b">Second</PaperListItem>
    <PaperListLabel>Another group</PaperListLabel>
    <PaperListItem value="c">Third</PaperListItem>
</PaperList>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="tabs">Closeable, reorderable tabs</PaperText>
            <PaperText preset="body" as="p">
                The terminal panel's tab strip is a horizontal list with <PaperCode>reorderable</PaperCode>, a close button on each tab, and the tab id as the value.
                It applies the new order to its own data and tells the user when saving the order failed.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import { PaperList, PaperListItem } from "@mileniumhq/paperui";

interface Tab {
    id: string;
    label: string;
}

export function Tabs(props: { initial: Tab[] }) {
    const [tabs, setTabs] = createSignal(props.initial);
    const [active, setActive] = createSignal(props.initial[0]?.id ?? "");

    return (
        <PaperList
            name="tabs"
            direction="horizontal"
            value={active()}
            onValueChange={(value) => setActive(String(value))}
            reorderable
            onReorder={(order) =>
                setTabs((current) =>
                    order.map((id) => current.find((tab) => tab.id === id)!).filter(Boolean),
                )
            }
        >
            <For each={tabs()}>
                {(tab) => (
                    <PaperListItem
                        value={tab.id}
                        icon="terminal"
                        onClosed={(id) => setTabs((current) => current.filter((item) => item.id !== id))}
                    >
                        {tab.label}
                    </PaperListItem>
                )}
            </For>
        </PaperList>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="confirm-close">Confirm before closing</PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import { PaperButton, PaperList, PaperListItem, PaperModal, PaperText } from "@mileniumhq/paperui";

export function Drafts() {
    const [tabs, setTabs] = createSignal([{ id: "draft", label: "Draft", unsaved: true }]);
    const [asking, setAsking] = createSignal<string | null>(null);
    const remove = (id: string) => setTabs((current) => current.filter((tab) => tab.id !== id));

    return (
        <>
            <PaperList name="drafts" value="draft">
                <For each={tabs()}>
                    {(tab) => (
                        <PaperListItem
                            value={tab.id}
                            closeable
                            onBeforeClose={() => {
                                if (!tab.unsaved) return true;
                                setAsking(tab.id);
                                return false;
                            }}
                            onClosed={(id) => remove(String(id))}
                        >
                            {tab.label}
                        </PaperListItem>
                    )}
                </For>
            </PaperList>
            <PaperModal
                open={asking() !== null}
                onClose={() => setAsking(null)}
                title="Discard changes"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setAsking(null)}>Keep editing</PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={() => {
                                remove(asking()!);
                                setAsking(null);
                            }}
                        >
                            Discard
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body" as="p">The draft has unsaved changes.</PaperText>
            </PaperModal>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="multiple">Several selected</PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperList, PaperListItem } from "@mileniumhq/paperui";

export function Filters() {
    const [chosen, setChosen] = createSignal<(string | number)[]>(["a"]);

    return (
        <PaperList name="filters" multiple values={chosen()} onValuesChange={setChosen} fullWidth borderless>
            <PaperListItem value="a">First</PaperListItem>
            <PaperListItem value="b">Second</PaperListItem>
        </PaperList>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink> for a compact set of choices, <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> for a panel's navigation, and <PaperLink href="/docs/paperui/paperchip/">PaperChip</PaperLink> for independent filter toggles.
            </PaperText>
        </PaperFlex>
    );
}
