import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperRail,
    PaperRailItem,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [activeRail, setActiveRail] = createSignal("studio");

    return (
        <>
            <PaperText preset="header">PaperRail</PaperText>
            <PaperText preset="body">
                <strong>PaperRail</strong> is a slim vertical navigation rail component designed for top-level workspace switching, icon-driven application navigation, and docked side controls.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperRail pairs with PaperRailItem to provide a narrow
                vertical action rail. It is typically anchored to the left
                viewport edge in desktop-class applications for switching
                between major workspaces, tool panels, or application modes.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The rail manages active selection state through the{" "}
                <PaperCode>name</PaperCode> and <PaperCode>value</PaperCode>{" "}
                props:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperRail, PaperRailItem } from "@paperboard-dev/paperui";

function AppNavigation() {
    const [workspace, setWorkspace] = createSignal("studio");

    return (
        <PaperRail
            name="app-rail"
            value={workspace()}
            onValueChange={(val) => setWorkspace(String(val))}
        >
            <PaperRailItem value="studio" icon="dashboard" label="Studio" />
            <PaperRailItem value="code" icon="terminal" label="Developer Console" />
            <PaperRailItem value="settings" icon="settings" label="Settings" />
        </PaperRail>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <div
                    style={{
                        width: "100%",
                        height: "var(--paper-centered-height-small)",
                        display: "flex",
                        "flex-direction": "row",
                        overflow: "hidden",
                        "border-radius": "var(--paper-border-radius)",
                        background: "var(--paper-background-frontest)",
                    }}
                >
                    <PaperRail
                        name="demo-rail"
                        value={activeRail()}
                        onValueChange={(val) => setActiveRail(String(val))}
                    >
                        <PaperRailItem
                            value="studio"
                            icon="dashboard"
                            label="Studio"
                        />
                        <PaperRailItem
                            value="code"
                            icon="terminal"
                            label="Developer Console"
                        />
                        <PaperRailItem
                            value="database"
                            icon="database"
                            label="Database Explorer"
                        />
                        <PaperRailItem
                            value="settings"
                            icon="settings"
                            label="Settings"
                        />
                    </PaperRail>

                    <div
                        style={{
                            flex: 1,
                            padding: "var(--paper-uigap-double)",
                            display: "flex",
                            "flex-direction": "column",
                            gap: "var(--paper-uigap)",
                            "overflow-y": "auto",
                        }}
                    >
                        <PaperFlex
                            direction="row"
                            align="center"
                            justify="space-between"
                        >
                            <PaperText preset="title">
                                {activeRail() === "studio"
                                    ? "Visual Studio Workspace"
                                    : activeRail() === "code"
                                      ? "Terminal and developer console"
                                      : activeRail() === "database"
                                        ? "Database schema and query inspector"
                                        : "Workspace Preferences"}
                            </PaperText>
                            <PaperCode>
                                Mode: {activeRail().toUpperCase()}
                            </PaperCode>
                        </PaperFlex>

                        <PaperSeparator />

                        <PaperText
                            preset="body"
                            color="light-text"
                        >
                            Selecting an icon on the rail switches the active
                            workspace. PaperRail docks to the viewport boundary
                            and manages single-selection context.
                        </PaperText>
                    </div>
                </div>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-rail" preset="title">
                PaperRail Props
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
                        <td>
                            <PaperCode>name</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <em>Required</em>
                        </td>
                        <td>
                            Radio group identifier assigned to the selection
                            context.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>value</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | number</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Active item identifier bound to an external reactive
                            signal.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>defaultValue</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | number</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Initial uncontrolled selection value.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onValueChange</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(value: string | number) =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Callback invoked whenever the active selection
                            changes.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperRailItem Props
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
                        <td>
                            <PaperCode>value</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | number</PaperCode>
                        </td>
                        <td>
                            <em>Required</em>
                        </td>
                        <td>Unique value identifier for this rail item.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>icon</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <em>Required</em>
                        </td>
                        <td>
                            Glyph name or icon element rendered within the rail
                            button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>label</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Tooltip and accessibility title attribute for the
                            button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>disabled</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>
                            Deactivates button interaction and dims the item icon.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-action" preset="title">
                PaperRailAction Props
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
                        <td>
                            <PaperCode>icon</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <em>Required</em>
                        </td>
                        <td>
                            Glyph name or icon element rendered within the action
                            button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>label</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Tooltip and accessibility title attribute for the
                            action button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onClick</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Click event handler triggered on every click without altering rail selection state.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papermenu">PaperMenu</PaperLink> —
                    Full-width hierarchical sidebar navigation menu.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> —
                    Horizontal and vertical selection list.
                </PaperText>
            </PaperTextList>
        </>
    );
}
