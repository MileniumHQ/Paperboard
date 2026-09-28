import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperList</PaperText>
            <PaperText preset="body">
                PaperList renders a selectable, reorderable list of items with optional close actions and icons.
                Reach for PaperList when managing browser tabs, playlist queues, or reorderable configuration lists.
                The list supports pointer-driven drag-and-drop reordering with transition animations.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place PaperListItem elements inside PaperList.
                Track the selected item through value and onValueChange props.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperList, PaperListItem, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="none" surface="front">
                <PaperList name="demo-list" defaultValue="tab1">
                <PaperListItem value="tab1" icon="terminal">Terminal</PaperListItem>
                <PaperListItem value="tab2" icon="folder">Files</PaperListItem>
                <PaperListItem value="tab3" icon="settings">Settings</PaperListItem>
            </PaperList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="none" surface="front">
            <PaperList name="demo-list" defaultValue="tab1">
                    <PaperListItem value="tab1" icon="terminal">Terminal</PaperListItem>
                    <PaperListItem value="tab2" icon="folder">Files</PaperListItem>
                    <PaperListItem value="tab3" icon="settings">Settings</PaperListItem>
                </PaperList>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperList provides list-wide behavior and reorder configurations:
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Prop</th>
                            <th>Type</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>name</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td>No default</td>
                            <td>Form group name identifying the radio selection context.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Currently active selected item value.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Initial selected value for uncontrolled lists.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>direction</PaperCode></td>
                            <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                            <td><PaperCode>"vertical"</PaperCode></td>
                            <td>Layout orientation. Setting horizontal arranges items in a row.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>reorderable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Enables pointer-based drag-and-drop reordering between items.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onReorder</PaperCode></td>
                            <td><PaperCode>(newOrder: (string | number)[]) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Callback executed when an item drop completes with the updated value array.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="body">
                PaperListItem accepts the per-row configuration below.
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Prop</th>
                            <th>Type</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td>No default</td>
                            <td>Value identifying this row in the list's selection.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon ligature or element.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>description</PaperCode></td>
                            <td><PaperCode>string | JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Secondary line rendered under the row title.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>actions</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Trailing controls such as a menu button. They must stop their own pointer events so the row does not select.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>closeable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Renders the built-in close button; onClose receives a cancellable close event.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Items manage selection through hidden radio inputs to ensure accessible screen reader announcements.
                When dragging items in a reorderable list, sibling items animate to preview drop placement.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Configure closeable tabs using the closeable prop on PaperListItem.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperList name="tabs-list" horizontal defaultValue="first">
    <PaperListItem value="first" closeable>Document 1</PaperListItem>
    <PaperListItem value="second" closeable>Document 2</PaperListItem>
</PaperList>`}
            </PaperCode>
            <PaperCard padding="none" surface="front">
                <PaperList name="tabs-list" horizontal defaultValue="first">
                    <PaperListItem value="first" closeable>Document 1</PaperListItem>
                    <PaperListItem value="second" closeable>Document 2</PaperListItem>
                </PaperList>
            </PaperCard>
        </PaperFlex>
    );
}
