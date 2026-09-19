import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSelector,
    PaperSelectorItem,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperSelectorDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSelector</PaperText>
            <PaperText preset="body">
                PaperSelector renders a group of card buttons for mutually exclusive option selection.
                Reach for PaperSelector when choosing layout presets, payment tiers, or view modes.
                Each option displays a solid offset shadow and primary border styling when active.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap PaperSelectorItem choices inside PaperSelector.
                Set horizontal to arrange options in a side-by-side row.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSelector, PaperSelectorItem, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
                <PaperSelector name="view-selector" defaultValue="opt1" horizontal>
                <PaperSelectorItem value="opt1" icon="view_module">Grid</PaperSelectorItem>
                <PaperSelectorItem value="opt2" icon="view_list">List</PaperSelectorItem>
            </PaperSelector>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
            <PaperSelector name="view-selector" defaultValue="opt1" horizontal>
                    <PaperSelectorItem value="opt1" icon="view_module">Grid</PaperSelectorItem>
                    <PaperSelectorItem value="opt2" icon="view_list">List</PaperSelectorItem>
                </PaperSelector>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSelector accepts group configuration props:
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
                            <td>Form group name identifying the radio input options.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Active selected item value.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Initial selected value for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>horizontal</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Renders options along a horizontal row instead of a vertical stack.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Items render hidden radio inputs to expose native keyboard navigation and accessibility tree roles.
                PaperEffect tints the offset shadow with primary accent coloration when selected.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Add descriptions to provide guidance for complex configuration choices.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperSelector name="tier-selector" defaultValue="basic">
    <PaperSelectorItem value="basic" description="Essential features">Basic</PaperSelectorItem>
    <PaperSelectorItem value="pro" description="All advanced developer tools">Developer</PaperSelectorItem>
</PaperSelector>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperSelector name="tier-selector" defaultValue="basic">
                    <PaperSelectorItem value="basic" description="Essential features">Basic</PaperSelectorItem>
                    <PaperSelectorItem value="pro" description="All advanced developer tools">Developer</PaperSelectorItem>
                </PaperSelector>
            </PaperCard>
        </PaperFlex>
    );
}
