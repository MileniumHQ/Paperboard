import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperList,
    PaperListItem,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [selectedItem, setSelectedItem] = createSignal<string>("item-1");
    const [activeTab, setActiveTab] = createSignal<string>("home");
    const [tabOrder, setTabOrder] = createSignal<string[]>(["home", "profile", "settings"]);

    return (
        <>
            <PaperText preset="header">PaperList</PaperText>
            <PaperText preset="body">
                A single-selection list and tab group component supporting horizontal/vertical layouts, pointer-driven drag-and-drop reordering, and dismissible items with lifecycle callbacks.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperList</strong> and <strong>PaperListItem</strong> coordinate selectable lists, tab strips, and reorderable item collections. Items encapsulate accessible radio input semantics under the hood, support leading icons, subtitles, close buttons, and smooth physics-driven drag translation during reorder operations.
            </PaperText>

            <PaperSeparator />

            <PaperText id="vertical-list" preset="subheader">
                Standard Vertical List
            </PaperText>
            <PaperText preset="body">
                List items can include descriptions and icons, updating an active value via <PaperCode>onValueChange</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperList, PaperListItem } from "paperui";

function ProjectSelector() {
    const [selected, setSelected] = createSignal("proj-1");

    return (
        <PaperList
            name="projects"
            value={selected()}
            onValueChange={(val) => setSelected(String(val))}
        >
            <PaperListItem
                value="proj-1"
                icon="folder"
                description="Updated 2 hours ago"
            >
                Alpha Engine
            </PaperListItem>
            <PaperListItem
                value="proj-2"
                icon="cloud"
                description="Deployed to production"
            >
                Cloud Relay
            </PaperListItem>
        </PaperList>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "380px" }}>
                        <PaperList
                            name="demo-list"
                            value={selectedItem()}
                            onValueChange={(val) => setSelectedItem(String(val))}
                        >
                            <PaperListItem
                                value="item-1"
                                icon="dashboard"
                                description="Primary operations console"
                            >
                                Dashboard Module
                            </PaperListItem>
                            <PaperListItem
                                value="item-2"
                                icon="analytics"
                                description="Real-time telemetry stream"
                            >
                                Analytics Engine
                            </PaperListItem>
                            <PaperListItem
                                value="item-3"
                                icon="settings"
                                description="Global system preferences"
                            >
                                System Config
                            </PaperListItem>
                        </PaperList>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="reorderable" preset="subheader">
                Reorderable Horizontal Tabs
            </PaperText>
            <PaperText preset="body">
                Adding <PaperCode>reorderable</PaperCode> and <PaperCode>horizontal</PaperCode> enables interactive tab strip drag-and-drop reordering:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperList
    horizontal
    reorderable
    name="editor-tabs"
    onReorder={(newOrder) => console.log("New tab order:", newOrder)}
>
    <PaperListItem value="home" icon="home" closeable>Home</PaperListItem>
    <PaperListItem value="profile" icon="person" closeable>Profile</PaperListItem>
    <PaperListItem value="settings" icon="settings" closeable>Settings</PaperListItem>
</PaperList>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center gap="full">
                    <PaperFlex direction="row" align="center" justify="space-between" style={{ width: "100%" }}>
                        <PaperText preset="title">Workspace Tabs</PaperText>
                        <PaperButton
                            tiny
                            variant="blue"
                            onClick={() => {
                                const allTabs = ["home", "profile", "settings", "analytics", "terminal"];
                                const next = allTabs.find((t) => !tabOrder().includes(t));
                                if (next) {
                                    setTabOrder([...tabOrder(), next]);
                                    setActiveTab(next);
                                }
                            }}
                            disabled={tabOrder().length >= 5}
                        >
                            + Add Tab
                        </PaperButton>
                    </PaperFlex>

                    <div style={{ width: "100%", overflow: "hidden", "border-radius": "var(--paper-border-radius)" }}>
                        <PaperList
                            horizontal
                            reorderable
                            name="reorder-demo"
                            value={activeTab()}
                            onValueChange={(val) => setActiveTab(String(val))}
                            onReorder={(order) => setTabOrder(order as string[])}
                            onItemClosed={(val) => {
                                const next = tabOrder().filter((t) => t !== val);
                                setTabOrder(next);
                                if (activeTab() === val && next.length > 0) {
                                    setActiveTab(next[0]);
                                }
                            }}
                        >
                            {tabOrder().map((id) => (
                                <PaperListItem
                                    value={id}
                                    icon={
                                        id === "home"
                                            ? "home"
                                            : id === "profile"
                                              ? "person"
                                              : id === "analytics"
                                                ? "analytics"
                                                : id === "terminal"
                                                  ? "terminal"
                                                  : "settings"
                                    }
                                    closeable
                                >
                                    {id.charAt(0).toUpperCase() + id.slice(1)}
                                </PaperListItem>
                            ))}
                        </PaperList>
                    </div>

                    <PaperText size={2} color="var(--paper-light-text)">
                        Active selected tab: <strong>{activeTab()}</strong> | Drag tabs horizontally to reorder or click the close icon to dismiss.
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
            </PaperText>

            <PaperText id="props-list" preset="title">
                PaperList Props
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
                        <td><em>Required</em></td>
                        <td>Radio group identifier assigned to internal selection context.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Currently active/selected item value identifier.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders items horizontally in a tab-strip row orientation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reorderable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Enables pointer-driven drag-and-drop item reordering.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onReorder</PaperCode></td>
                        <td><PaperCode>(values: (string | number)[]) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed upon completion of an item reordering gesture.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperListItem Props
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
                        <td><em>Required</em></td>
                        <td>Unique value identifier associated with this item.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Leading icon displayed alongside the item title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary text rendered beneath the item label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>closeable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders a trailing close button triggering dismiss lifecycle events.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papermenu">PaperMenu</PaperLink> — Collapsible hierarchical sidebar menu component.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperselector">PaperSelector</PaperLink> — Segmented radio control.
                </PaperText>
            </PaperTextList>
        </>
    );
}
