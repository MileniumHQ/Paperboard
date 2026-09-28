import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInput,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperInputDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperInput</PaperText>
            <PaperText preset="body">
                PaperInput renders a text field with optional leading icons and built-in validation states.
                Reach for PaperInput when gathering user text, searching lists, or configuring numeric properties.
                Set multiline to render a textarea instead, keeping every other prop unchanged.
                The field displays custom focus rings, error outlines, and compact dimension variants.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Provide placeholder and value bindings to receive user input.
                Pass an icon string to show a leading glyph inside the input frame.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperInput, PaperCard, PaperFlex } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperInput placeholder="Search records" icon="search" fullWidth />
                <PaperInput placeholder="Compact input" compact />
                <PaperInput placeholder="Invalid value" invalid value="incorrect" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperInput placeholder="Search records" icon="search" fullWidth />
                    <PaperInput placeholder="Compact input" compact />
                    <PaperInput placeholder="Invalid value" invalid value="incorrect" />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperInput accepts the following configuration properties:
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
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon rendered inside the left padding of the input box.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>compact</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Reduces vertical padding and height for dense table rows or toolbars.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullWidth</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Expands input container width to 100% of the parent element.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>invalid</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Forces danger border coloration and invalid aria attributes.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>validate</PaperCode></td>
                            <td><PaperCode>(value: string) =&gt; boolean</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Validation predicate function executed on text changes. Returning false flags the input invalid.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>defaultValue</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td><PaperCode>""</PaperCode></td>
                            <td>Initial text value for uncontrolled operation.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>multiline</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Renders a textarea in place of the single-line field. Every other prop behaves the same.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>rows</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>4</PaperCode></td>
                            <td>Visible text rows when multiline is set. Ignored otherwise.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>resize</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Whether the browser resize affordance is available when multiline is set.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="multiline">Multiline</PaperText>
            <PaperText preset="body">
                Set multiline to collect text that spans more than one line.
                The field keeps the icon slot, the validation contract, and the disabled and compact variants of the single-line form.
                Pass rows to control the visible height, and resize to remove the drag handle when the surrounding layout should stay fixed.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperFlex, PaperInput } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperInput multiline rows={4} placeholder="Notes" fullWidth />
                <PaperInput multiline rows={2} resize={false} placeholder="Fixed height" fullWidth />
                <PaperInput multiline icon="search" rows={3} placeholder="Multiline with icon" fullWidth />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperInput multiline rows={4} placeholder="Notes" fullWidth />
                    <PaperInput multiline rows={2} resize={false} placeholder="Fixed height" fullWidth />
                    <PaperInput multiline icon="search" rows={3} placeholder="Multiline with icon" fullWidth />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When validation fails, data-invalid is set to true and aria-invalid is added to the native field element.
                Focus states project an outer focus ring using var(--paper-primary).
                A multiline field fills the width of its parent, because a textarea has no natural single-line width to fit.
                Attributes that only exist on an input, such as type, min, max, step, pattern and size, have no effect in multiline mode.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Validate input values dynamically using a regular expression.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperInput
    placeholder="username"
    validate={(val) => /^[a-z0-9_-]+$/.test(val)}
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperInput
                    placeholder="username"
                    validate={(val) => /^[a-z0-9_-]+$/.test(val)}
                />
            </PaperCard>
        </PaperFlex>
    );
}
