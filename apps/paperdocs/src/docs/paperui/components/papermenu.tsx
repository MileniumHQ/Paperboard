import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [selectedPage, setSelectedPage] = createSignal("intro");
    const [selectedSpaced, setSelectedSpaced] = createSignal("overview");

    return (
        <>
            <PaperText preset="header">PaperMenu</PaperText>
            <PaperText preset="body">
                <strong>PaperMenu</strong> is a hierarchical navigation component in PaperUI featuring collapsible sections, nested indentation levels, animated chevron indicators, single-selection semantics, and spacing modifiers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The PaperMenu suite—PaperMenu, PaperMenuSection, and PaperMenuItem—serves as the primary sidebar navigation structure in PaperUI applications. Sections provide collapsible hierarchies with animated chevron indicators, while individual items coordinate selection highlights through a shared radio context. Arrow keys move focus between items and section headers, and <PaperCode>Home</PaperCode> / <PaperCode>End</PaperCode> jump to the first and last focusable element.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Menus coordinate selection across nested sections using the <PaperCode>name</PaperCode> and <PaperCode>value</PaperCode> props:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperMenu, PaperMenuSection, PaperMenuItem } from "@paperboard-dev/paperui";

function AppSidebar() {
    const [currentRoute, setCurrentRoute] = createSignal("intro");

    return (
        <PaperMenu
            name="sidebar-nav"
            value={currentRoute()}
            onValueChange={(val) => setCurrentRoute(String(val))}
        >
            <PaperMenuSection title="Getting Started" icon="rocket_launch">
                <PaperMenuItem value="intro" icon="info">Introduction</PaperMenuItem>
                <PaperMenuItem value="quick-start" icon="bolt">Quick Start</PaperMenuItem>
            </PaperMenuSection>

            <PaperMenuSection title="Components" icon="widgets">
                <PaperMenuItem value="button" icon="smart_button">PaperButton</PaperMenuItem>
                <PaperMenuItem value="input" icon="edit">PaperInput</PaperMenuItem>
            </PaperMenuSection>
        </PaperMenu>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "300px" }}>
                        <PaperMenu
                            name="demo-menu"
                            value={selectedPage()}
                            onValueChange={(val) => setSelectedPage(String(val))}
                        >
                            <PaperMenuSection title="Documentation" icon="book">
                                <PaperMenuItem value="intro" icon="description">
                                    Overview
                                </PaperMenuItem>
                                <PaperMenuItem value="install" icon="download">
                                    Installation
                                </PaperMenuItem>
                            </PaperMenuSection>

                            <PaperMenuSection title="Configuration" icon="settings">
                                <PaperMenuItem value="general" icon="tune">
                                    General Settings
                                </PaperMenuItem>
                                <PaperMenuItem value="security" icon="shield">
                                    Security & Keys
                                </PaperMenuItem>
                            </PaperMenuSection>
                        </PaperMenu>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="spacing-option" preset="subheader">
                Item spacing modifier
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>spacing</PaperCode> prop accepts a boolean flag (which defaults to a 3px <PaperCode>"onefourth"</PaperCode> gap) or any standard <PaperCode>PaperSpacing</PaperCode> token (such as <PaperCode>"half"</PaperCode>, <PaperCode>"threefourths"</PaperCode>, or <PaperCode>"full"</PaperCode>) to apply vertical separation between adjacent navigation items and collapsible sections:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperMenu name="spaced-nav" spacing="half" value={activeTab()} onValueChange={setActiveTab}>
    <PaperMenuItem value="overview" icon="dashboard">Overview</PaperMenuItem>
    <PaperMenuItem value="console" icon="terminal">Console</PaperMenuItem>
    <PaperMenuItem value="options" icon="tune">Options</PaperMenuItem>
</PaperMenu>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "300px" }}>
                        <PaperMenu
                            name="spaced-demo-menu"
                            spacing="half"
                            value={selectedSpaced()}
                            onValueChange={(val) => setSelectedSpaced(String(val))}
                        >
                            <PaperMenuItem value="overview" icon="dashboard">
                                Overview
                            </PaperMenuItem>
                            <PaperMenuItem value="console" icon="terminal">
                                Console
                            </PaperMenuItem>
                            <PaperMenuItem value="options" icon="tune">
                                Options
                            </PaperMenuItem>
                            <PaperMenuItem value="players" icon="group">
                                Players
                            </PaperMenuItem>
                        </PaperMenu>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-menu" preset="title">
                PaperMenu Props
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
                        <td>Controlled value identifier of the currently selected menu item.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Initial uncontrolled selection value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed whenever the active selection changes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"vertical"</PaperCode></td>
                        <td>Layout direction of the menu container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Convenience shorthand for horizontal menu layout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>spacing</PaperCode></td>
                        <td><PaperCode>boolean | PaperSpacing</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Applies a spacing token gap (e.g. <PaperCode>"half"</PaperCode>, <PaperCode>"onefourth"</PaperCode>, <PaperCode>true</PaperCode>) between navigation items and collapsible sections.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-section" preset="title">
                PaperMenuSection Props
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
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><em>Required</em></td>
                        <td>Header label text rendered for the collapsible group.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Leading icon displayed beside the section title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultOpen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Initial expansion state for the collapsible container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Controlled expansion state for external control.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>collapsible</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Enables clicking header to toggle section visibility.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperMenuItem Props
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
                        <td>Unique value identifier associated with this navigation destination.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Leading icon displayed alongside item text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary text rendered below the primary item label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Prevents item selection and applies muted visual styling.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>level</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>section nesting depth (0 at the top level)</PaperCode></td>
                        <td>Overrides the indent depth manually. Items inside a PaperMenuSection inherit that section's nesting level; setting level replaces it with an explicit value.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperrail">PaperRail</PaperLink> — Vertical icon rail navigation bar.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> — Selectable tab and list component.
                </PaperText>
            </PaperTextList>
        </>
    );
}
