import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperIcon,
    PaperInterfaceGroup,
    PaperInterfaceItem,
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
    const [selectedTab, setSelectedTab] = createSignal<string>("tab1");

    return (
        <>
            <PaperText preset="header">PaperInterfaceGroup</PaperText>
            <PaperText preset="body">
                <strong>PaperInterfaceGroup</strong> is a declarative conditional rendering template designed for
                multi-view navigation, sub-interface switching, tab panels, and
                state-driven interface segregation.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperInterfaceGroup coordinates the selective
                visibility of nested <PaperCode>PaperInterfaceItem</PaperCode> (or{" "}
                <PaperCode>PaperInterfaceStep</PaperCode>) children by comparing an
                active controller value against item keys through SolidJS
                context propagation.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The group coordinates with controllers such as{" "}
                <PaperLink href="/paperui/paperselector">
                    <PaperCode>PaperSelector</PaperCode>
                </PaperLink>{" "}
                or{" "}
                <PaperLink href="/paperui/paperrail">
                    <PaperCode>PaperRail</PaperCode>
                </PaperLink>{" "}
                by binding the active signal to the <PaperCode>value</PaperCode>{" "}
                prop:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperSelector,
    PaperSelectorItem,
    PaperFlex,
    PaperText,
} from "@paperboard-dev/paperui";

function TabbedView() {
    const [activeTab, setActiveTab] = createSignal("overview");

    return (
        <PaperFlex gap="full">
            <PaperSelector
                horizontal
                value={activeTab()}
                onValueChange={(val) => setActiveTab(String(val))}
            >
                <PaperSelectorItem value="overview">Overview</PaperSelectorItem>
                <PaperSelectorItem value="settings">Settings</PaperSelectorItem>
            </PaperSelector>

            <PaperInterfaceGroup value={activeTab()}>
                <PaperInterfaceItem value="overview">
                    <PaperText preset="body">Overview panel content.</PaperText>
                </PaperInterfaceItem>
                <PaperInterfaceItem value="settings">
                    <PaperText preset="body">Settings panel content.</PaperText>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <PaperSelector
                        horizontal
                        name="tabSelect"
                        value={selectedTab()}
                        onValueChange={(val) => setSelectedTab(String(val))}
                    >
                        <PaperSelectorItem value="tab1" icon="dashboard">
                            Dashboard
                        </PaperSelectorItem>
                        <PaperSelectorItem value="tab2" icon="analytics">
                            Metrics
                        </PaperSelectorItem>
                        <PaperSelectorItem value="tab3" icon="tune">
                            Config
                        </PaperSelectorItem>
                    </PaperSelector>

                    <PaperContainer
                        style={{ width: "100%", "min-height": "120px" }}
                    >
                        <PaperFlex padding="double" center>
                            <PaperInterfaceGroup value={selectedTab()}>
                                <PaperInterfaceItem value="tab1">
                                    <PaperFlex gap="half" center>
                                        <PaperText preset="title">
                                            Dashboard View
                                        </PaperText>
                                        <PaperText preset="body">
                                            Displaying live operational status.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperInterfaceItem>
                                <PaperInterfaceItem value="tab2">
                                    <PaperFlex gap="half" center>
                                        <PaperText preset="title">
                                            Metrics View
                                        </PaperText>
                                        <PaperText preset="body">
                                            System throughput: 99.98%
                                            availability.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperInterfaceItem>
                                <PaperInterfaceItem value="tab3">
                                    <PaperFlex gap="half" center>
                                        <PaperText preset="title">
                                            Configuration View
                                        </PaperText>
                                        <PaperText preset="body">
                                            Modify parameters and pipeline
                                            routes.
                                        </PaperText>
                                    </PaperFlex>
                                </PaperInterfaceItem>
                            </PaperInterfaceGroup>
                        </PaperFlex>
                    </PaperContainer>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-group" preset="title">
                PaperInterfaceGroup props
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
                        <td>
                            The identifier of the currently active view or
                            panel.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>children</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Set of <PaperCode>PaperInterfaceItem</PaperCode>{" "}
                            child components.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperInterfaceItem Props
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
                        <td>
                            Unique value identifier matching the parent group
                            condition.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>children</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            DOM elements conditionally rendered when this item
                            is active.
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
                    <PaperLink href="/paperui/paperselector">
                        PaperSelector
                    </PaperLink>{" "}
                    — Segmented interactive control frequently used to switch
                    groups.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperrail">PaperRail</PaperLink> —
                    Vertical icon rail navigation component.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperwizard">
                        PaperWizard
                    </PaperLink>{" "}
                    — Linear multi-step sequential wizard template.
                </PaperText>
            </PaperTextList>
        </>
    );
}
