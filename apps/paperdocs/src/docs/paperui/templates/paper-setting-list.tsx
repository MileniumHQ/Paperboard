import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";

export default function PaperSettingListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSettingList</PaperText>
            <PaperText preset="body">
                PaperSettingList structures setting rows with titles, descriptive explanations, and trailing input controls.
                Reach for PaperSettingList when building preferences pages, configuration drawers, or account panels.
                The list listens to input events from child controls and updates form records automatically.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place PaperSettingItem rows inside PaperSettingList.
                Embed interactive controls like toggles or select menus in the item children slot.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSettingList, PaperSettingItem, PaperToggle, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperSettingList>
                <PaperSettingItem
                    title="Automatic updates"
                    description="Download and verify updates in the background."
                >
                    <PaperToggle name="autoUpdate" defaultChecked />
                </PaperSettingItem>
                <PaperSettingItem
                    title="Hardware acceleration"
                    description="Render terminal canvases using GPU shaders."
                >
                    <PaperToggle name="gpu" />
                </PaperSettingItem>
            </PaperSettingList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperSettingList>
                    <PaperSettingItem
                        title="Automatic updates"
                        description="Download and verify updates in the background."
                    >
                        <PaperToggle name="autoUpdate" defaultChecked />
                    </PaperSettingItem>
                    <PaperSettingItem
                        title="Hardware acceleration"
                        description="Render terminal canvases using GPU shaders."
                    >
                        <PaperToggle name="gpu" />
                    </PaperSettingItem>
                </PaperSettingList>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSettingList accepts form storage and height properties:
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
                            <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Controlled state dictionary for named inputs within the list.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                            <td><PaperCode>{}</PaperCode></td>
                            <td>Initial dictionary for uncontrolled settings state.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onValueChange</PaperCode></td>
                            <td><PaperCode>(values: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Callback executed whenever any named input or toggle updates.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>autoHeight</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Allows rows to expand vertically rather than maintaining fixed row heights.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>flat</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Drops the card border and rounding for full-bleed panes, such as the Paperboard settings screen.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperSettingList captures input and change events from descendants carrying a name attribute.
                Child input names map directly to dictionary keys in the onValueChange payload.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Disable individual setting items using the disabled prop.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperSettingItem title="Experimental features" description="Requires host reboot" disabled>
    <PaperToggle disabled />
</PaperSettingItem>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperSettingItem title="Experimental features" description="Requires host reboot" disabled>
                    <PaperToggle disabled />
                </PaperSettingItem>
            </PaperCard>
        </PaperFlex>
    );
}
