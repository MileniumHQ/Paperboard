import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperKbd,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperKbdDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperKbd</PaperText>
            <PaperText preset="body">
                PaperKbd formats keyboard shortcut keycaps with bordered backgrounds and monospace metrics.
                Reach for PaperKbd when documenting hotkeys, command shortcuts, or input trigger combinations.
                The keycap maintains a minimum width to keep single-character keys legible.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass key names or symbol characters as children to PaperKbd.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperKbd, PaperCard, PaperFlex, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="half" align="center">
                <PaperText preset="body">Press</PaperText>
                <PaperKbd>Ctrl</PaperKbd>
                <PaperText preset="body">+</PaperText>
                <PaperKbd>Shift</PaperKbd>
                <PaperText preset="body">+</PaperText>
                <PaperKbd>P</PaperKbd>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperText preset="body">Press</PaperText>
                    <PaperKbd>Ctrl</PaperKbd>
                    <PaperText preset="body">+</PaperText>
                    <PaperKbd>Shift</PaperKbd>
                    <PaperText preset="body">+</PaperText>
                    <PaperKbd>P</PaperKbd>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperKbd accepts standard HTML keyboard element attributes:
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
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>Keycap label or symbol.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperKbd renders a native kbd tag styled with monospace typography from var(--paper-font-family-code).
                The element sets minimum width to var(--paper-kbd-min-width) and centers glyphs.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Display common navigation shortcuts in table rows or tooltips.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="half" align="center">
    <PaperKbd>Esc</PaperKbd>
    <PaperText size={2} color="text-subtle">Close modal</PaperText>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperKbd>Esc</PaperKbd>
                    <PaperText size={2} color="text-subtle">Close modal</PaperText>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
