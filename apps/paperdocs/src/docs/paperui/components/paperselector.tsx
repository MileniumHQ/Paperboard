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
} from "paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [horizontalMode, setHorizontalMode] = createSignal("grid");
    const [verticalMode, setVerticalMode] = createSignal("standard");

    return (
        <>
            <PaperText preset="header">PaperSelector</PaperText>
            <PaperText preset="body">
                A tactile segmented radio selection control component for choosing among mutually exclusive options, display modes, or configuration presets.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperSelector</strong> and <strong>PaperSelectorItem</strong> provide high-visibility segmented choice controls. Each item is backed by an interactive <PaperLink href="/paperui/papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink> wrapper that elevates into an active brand-tinted tactile state upon selection.
            </PaperText>

            <PaperSeparator />

            <PaperText id="horizontal-mode" preset="subheader">
                Horizontal Segmented Control
            </PaperText>
            <PaperText preset="body">
                Setting <PaperCode>horizontal</PaperCode> aligns items in a row suitable for view switchers, layout pickers, and toolbars:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "paperui";

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
                Vertical Option Cards
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
                Technical Specification
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
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Lays out selector items in a horizontal row.</td>
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
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary text rendered below the item title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reverse</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Places the icon on the trailing right edge.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
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
