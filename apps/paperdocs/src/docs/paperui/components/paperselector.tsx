import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSelector,
    PaperSelectorItem,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [horizontalMode, setHorizontalMode] = createSignal("grid");
    const [verticalMode, setVerticalMode] = createSignal("standard");

    return (
        <>
            <PaperText preset="header">PaperSelector</PaperText>
            <PaperText preset="body">
                <strong>PaperSelector</strong> is a segmented radio selection control for choosing among mutually exclusive options, display modes, or configuration presets.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperSelector renders a set of PaperSelectorItem options as a segmented control. Each item is wrapped in an interactive <PaperLink href="/paperui/papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink> layer that elevates when selected.
            </PaperText>

            <PaperSeparator />

            <PaperText id="horizontal-mode" preset="subheader">
                Horizontal segmented control
            </PaperText>
            <PaperText preset="body">
                Setting <PaperCode>horizontal</PaperCode> aligns items in a row suitable for view switchers, layout pickers, and toolbars:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "@paperboard-dev/paperui";

function ViewModeSelector() {
    const [view, setView] = createSignal("grid");

    return (
        <PaperSelector
            horizontal
            name="view-mode"
            value={view()}
            onValueChange={(val) => setView(String(val))}
        >
            <PaperSelectorItem value="grid" icon="grid_view">Grid</PaperSelectorItem>
            <PaperSelectorItem value="list" icon="view_list">List</PaperSelectorItem>
            <PaperSelectorItem value="table" icon="table_chart">Table</PaperSelectorItem>
        </PaperSelector>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperSelector
                        horizontal
                        name="demo-horiz"
                        value={horizontalMode()}
                        onValueChange={(val) => setHorizontalMode(String(val))}
                    >
                        <PaperSelectorItem value="grid" icon="grid_view">Grid</PaperSelectorItem>
                        <PaperSelectorItem value="list" icon="view_list">List</PaperSelectorItem>
                        <PaperSelectorItem value="table" icon="table_chart">Table</PaperSelectorItem>
                    </PaperSelector>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="vertical-mode" preset="subheader">
                Vertical option cards
            </PaperText>
            <PaperText preset="body">
                In vertical mode, items can include detailed multi-line descriptions:
            </PaperText>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "380px" }}>
                        <PaperSelector
                            name="demo-vert"
                            value={verticalMode()}
                            onValueChange={(val) => setVerticalMode(String(val))}
                        >
                            <PaperSelectorItem
                                value="standard"
                                icon="speed"
                                description="Optimized for latency and interactive workflows."
                            >
                                Standard Profile
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="balanced"
                                icon="balance"
                                description="Balanced memory allocation and throughput."
                            >
                                Balanced Profile
                            </PaperSelectorItem>
                        </PaperSelector>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-selector" preset="title">
                PaperSelector Props
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
                        <td>Currently selected value identifier.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Initial uncontrolled selection value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"vertical"</PaperCode></td>
                        <td>Layout direction of the selector container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Shorthand for <PaperCode>direction="horizontal"</PaperCode>; lays out selector items in a horizontal row.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback invoked when user selects a different item.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperSelectorItem Props
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
                        <td>Unique value identifier for this option.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Icon glyph name or element displayed within the option.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary content rendered below the item title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reverse</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Places the icon on the trailing right edge.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Prevents selection and disables hover elevation on the item.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>colorless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true when unselected</PaperCode></td>
                        <td>Renders the item without the brand color accent; selected items are colored unless this is set.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papereffect">PaperEffect</PaperLink> — Tactile decorator component powering selector elevation.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> — Selection list and tab component.
                </PaperText>
            </PaperTextList>
        </>
    );
}
