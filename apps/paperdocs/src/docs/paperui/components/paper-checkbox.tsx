import {
    PaperCard,
    PaperCheckbox,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperCheckboxDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperCheckbox</PaperText>
            <PaperText preset="body">
                PaperCheckbox renders an accessible binary check input with optional label and description text.
                Reach for PaperCheckbox when toggling individual options, approving agreements, or selecting batch rows.
                The component supports both controlled and uncontrolled operation.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Provide a label prop to describe the checkbox intent.
                Listen to state changes through the onChange callback.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCheckbox, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperCheckbox label="Checkbox" defaultChecked />
                <PaperCheckbox label="Option" description="Secondary description text" />
                <PaperCheckbox label="Disabled" disabled />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperCheckbox label="Checkbox" defaultChecked />
                    <PaperCheckbox label="Option" description="Secondary description text" />
                    <PaperCheckbox label="Disabled" disabled />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperCheckbox accepts the following properties:
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
                            <td><PaperCode>checked</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Controlled boolean state. When set, internal state tracking is bypassed.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultChecked</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Initial boolean state for uncontrolled usage.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onChange</PaperCode></td>
                            <td><PaperCode>(checked: boolean) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Callback invoked when the checkbox is clicked or toggled via keyboard.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Primary text rendered next to the checkbox control box.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>description</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Subordinate descriptive text rendered beneath the label.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Prevents interaction and applies dimmed styling.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperCheckbox wraps a native hidden input inside an accessible label container.
                Pressing the Space bar or Enter key toggles the checked value when focused.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Group multiple checkboxes inside a flex column for settings forms.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperCheckbox label="Enabled" defaultChecked />
    <PaperCheckbox label="Telemetry" />
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperCheckbox label="Enabled" defaultChecked />
                    <PaperCheckbox label="Telemetry" />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
