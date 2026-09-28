import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperMenuDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperMenu</PaperText>
            <PaperText preset="body">
                PaperMenu renders hierarchical navigation trees with collapsible sections and selectable items.
                Reach for PaperMenu when constructing sidebars, documentation indexes, or settings categories.
                The menu manages focus traversal, collapsible headers, and selection radio semantics.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Structure views using PaperMenuSection categories and PaperMenuItem links.
                Track active selections via value and onValueChange props.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMenu, PaperMenuSection, PaperMenuItem, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
                <PaperMenu name="nav-menu" defaultValue="overview">
                <PaperMenuSection title="General" icon="info">
                    <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
                    <PaperMenuItem value="settings" icon="settings">Settings</PaperMenuItem>
                </PaperMenuSection>
            </PaperMenu>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
            <PaperMenu name="nav-menu" defaultValue="overview">
                    <PaperMenuSection title="General" icon="info">
                        <PaperMenuItem value="overview" icon="home">Overview</PaperMenuItem>
                        <PaperMenuItem value="settings" icon="settings">Settings</PaperMenuItem>
                    </PaperMenuSection>
                </PaperMenu>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperMenu accepts the following navigation properties:
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
                            <td>Unique selection group identifier.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Selected menu item value key.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Initial selected value for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>spacing</PaperCode></td>
                            <td><PaperCode>boolean | PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Item gap spacing token or boolean flag.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>horizontal</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Arranges menu items along a horizontal axis.</td>
                        </tr>
                                            <tr>
                            <td><PaperCode>embedded</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Drops the trailing divider, surface and internal scrolling so a host sidebar can supply its own frame.</td>
                        </tr>
</tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperMenu handles keyboard arrow navigation between sibling items and sections.
                Home and End keys move focus directly to the first and last focusable items.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Add secondary descriptions to items for sub-label details.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperMenu name="sub-menu" defaultValue="item1">
    <PaperMenuItem value="item1" description="Status and health readouts">
        Diagnostics
    </PaperMenuItem>
</PaperMenu>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperMenu name="sub-menu" defaultValue="item1">
                    <PaperMenuItem value="item1" description="Status and health readouts">
                        Diagnostics
                    </PaperMenuItem>
                </PaperMenu>
            </PaperCard>
        </PaperFlex>
    );
}
