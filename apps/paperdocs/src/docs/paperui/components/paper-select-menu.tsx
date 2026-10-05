import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperSelectMenuDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSelectMenu</PaperText>
            <PaperText preset="body">
                PaperSelectMenu renders a dropdown select trigger opening a portal menu with single-choice selection.
                Reach for PaperSelectMenu when presenting lists of options inside forms or filter bars.
                The menu positions itself over page content using portal overlays and keyboard focus traps.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place PaperSelectMenuItem options inside PaperSelectMenu.
                Bind selection using value and onValueChange props.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSelectMenu, PaperSelectMenuItem, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
                <PaperSelectMenu name="region-select" defaultValue="us" placeholder="Select region">
                <PaperSelectMenuItem value="us" icon="public">United States</PaperSelectMenuItem>
                <PaperSelectMenuItem value="eu" icon="public">Europe</PaperSelectMenuItem>
                <PaperSelectMenuItem value="ap" icon="public">Asia Pacific</PaperSelectMenuItem>
            </PaperSelectMenu>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
            <PaperSelectMenu name="region-select" defaultValue="us" placeholder="Select region">
                    <PaperSelectMenuItem value="us" icon="public">United States</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="eu" icon="public">Europe</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="ap" icon="public">Asia Pacific</PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSelectMenu accepts the following configuration properties:
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
                            <td>Form group name identifying the selection radio input.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Selected option value.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Initial selected value for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>placeholder</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"Select"</PaperCode></td>
                            <td>Placeholder text shown when no option is selected.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullWidth</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Expands the trigger button to fill 100% container width.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Disables opening the dropdown menu.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The popup is the same menu element as PaperContextMenu: same panel surface, item layout, hover and
                keyboard behavior. A PaperSelectMenuItem may declare a description, which renders as a second line
                the way a context menu item does.
                The popup portal measures window boundaries to flip above the trigger if screen space below is insufficient.
                Pressing ArrowDown or ArrowUp steps through options; Home and End jump to the ends; Enter commits the selection.
                When the selected PaperSelectMenuItem declares an icon, the trigger mirrors it next to the label, so logos and glyphs stay visible while the menu is closed.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Expand the select menu full width inside settings forms.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperSelectMenu name="entries-select" fullWidth defaultValue="10">
    <PaperSelectMenuItem value="10">10 entries</PaperSelectMenuItem>
    <PaperSelectMenuItem value="25">25 entries</PaperSelectMenuItem>
</PaperSelectMenu>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperSelectMenu name="entries-select" fullWidth defaultValue="10">
                    <PaperSelectMenuItem value="10">10 entries</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="25">25 entries</PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperCard>
        </PaperFlex>
    );
}
