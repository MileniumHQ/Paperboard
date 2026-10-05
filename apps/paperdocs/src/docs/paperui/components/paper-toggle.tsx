import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";

export default function PaperToggleDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperToggle</PaperText>
            <PaperText preset="body">
                PaperToggle renders an animated sliding switch for binary on-off state toggles.
                Reach for PaperToggle in settings lists, feature activations, or service power switches.
                The toggle includes track icons, transition animations, and accessible switch roles.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Provide checked or defaultChecked to set the initial toggle state.
                Listen to user interactions through the onChange callback.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperToggle, PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="double" align="center">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperToggle defaultChecked />
                    <PaperText size={2}>Enabled</PaperText>
                </PaperFlex>
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperToggle disabled />
                    <PaperText size={2}>Disabled</PaperText>
                </PaperFlex>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center">
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperToggle defaultChecked />
                        <PaperText size={2}>Enabled</PaperText>
                    </PaperFlex>
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperToggle disabled />
                        <PaperText size={2}>Disabled</PaperText>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperToggle accepts the following properties:
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
                            <td>Controlled boolean switch state.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultChecked</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Initial boolean state for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onChange</PaperCode></td>
                            <td><PaperCode>(checked: boolean) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Callback executed when the toggle state switches.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>showIcons</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Displays check and close glyphs inside the sliding thumb knob.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Prevents user interaction and applies dimmed opacity.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperToggle exposes role="switch" and aria-checked to screen readers.
                Space and Enter keys toggle the switch when the control is focused.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Hide internal knob glyphs using showIcons={false}.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperToggle showIcons={false} defaultChecked />`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperToggle showIcons={false} defaultChecked />
            </PaperCard>
        </PaperFlex>
    );
}
