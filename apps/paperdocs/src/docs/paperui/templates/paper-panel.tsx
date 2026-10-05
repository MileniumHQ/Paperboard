import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperPanel,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperPanelDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperPanel</PaperText>
            <PaperText preset="body">
                PaperPanel serves as the foundational application shell coordinating side navigation with active interface panels.
                Reach for PaperPanel as the root container of your Paperboard panel application.
                The shell establishes layout context so navigation bars size themselves and active views claim remaining scrollable space.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place PaperMenu and PaperInterfaceGroup as direct children of PaperPanel.
                The shell manages flex distribution and overflow clipping across viewports.
            </PaperText>
            <PaperCode block language="tsx">
{`import {
    PaperPanel,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperCard,
    PaperText,
} from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="none" surface="back" style={{ height: "240px" }}>
            <PaperPanel direction="row">
                    <PaperMenu name="panel-menu" defaultValue="tab1" style={{ width: "160px" }}>
                    <PaperMenuItem value="tab1" icon="dashboard">Dashboard</PaperMenuItem>
                    <PaperMenuItem value="tab2" icon="settings">Settings</PaperMenuItem>
                </PaperMenu>
                <PaperInterfaceGroup value="tab1">
                    <PaperInterfaceItem value="tab1" variant="plain">
                        <PaperCard padding="double" surface="front">
                            <PaperText preset="body">Dashboard content</PaperText>
                        </PaperCard>
                    </PaperInterfaceItem>
                </PaperInterfaceGroup>
            </PaperPanel>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="none" surface="back" style={{ height: "240px" }}>
                <PaperPanel direction="row">
                <PaperMenu name="panel-menu" defaultValue="tab1" style={{ width: "160px" }}>
                        <PaperMenuItem value="tab1" icon="dashboard">Dashboard</PaperMenuItem>
                        <PaperMenuItem value="tab2" icon="settings">Settings</PaperMenuItem>
                    </PaperMenu>
                    <PaperInterfaceGroup value="tab1">
                        <PaperInterfaceItem value="tab1" variant="plain">
                            <PaperCard padding="double" surface="front">
                                <PaperText preset="body">Dashboard content</PaperText>
                            </PaperCard>
                        </PaperInterfaceItem>
                    </PaperInterfaceGroup>
                </PaperPanel>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperPanel accepts the following layout orientation property:
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
                            <td><PaperCode>direction</PaperCode></td>
                            <td><PaperCode>"row" | "column"</PaperCode></td>
                            <td><PaperCode>"row"</PaperCode></td>
                            <td>Layout axis between the navigation menu and interface group.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperPanel provides a panel context with inPanel set to true.
                Child interface groups consume this flag to optimize scroll boundaries and flex growth.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use column direction on narrow screens or top-navigation layouts.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPanel direction="column">
    <PaperMenu name="top-menu" horizontal defaultValue="tab1">
        <PaperMenuItem value="tab1">Overview</PaperMenuItem>
    </PaperMenu>
</PaperPanel>`}
            </PaperCode>
        </PaperFlex>
    );
}
