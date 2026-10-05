import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSeparator,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperSeparatorDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSeparator</PaperText>
            <PaperText preset="body">
                PaperSeparator renders a subtle dividing rule across horizontal or vertical content divisions.
                Reach for PaperSeparator when dividing sections, menu items, or toolbar action groups.
                The divider consumes theme border tokens to maintain contrast across color themes.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Render PaperSeparator between adjacent elements.
                Set vertical to true when partitioning horizontal rows.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSeparator, PaperButton, PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperText preset="body">First section</PaperText>
                <PaperSeparator />
                <PaperText preset="body">Second section</PaperText>
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperButton size="tiny">Cut</PaperButton>
                    <PaperSeparator vertical />
                    <PaperButton size="tiny">Copy</PaperButton>
                </PaperFlex>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body">First section</PaperText>
                    <PaperSeparator />
                    <PaperText preset="body">Second section</PaperText>
                    <PaperFlex direction="row" gap="full" align="center">
                        <PaperButton size="tiny">Cut</PaperButton>
                        <PaperSeparator vertical />
                        <PaperButton size="tiny">Copy</PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSeparator accepts orientation properties:
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
                            <td><PaperCode>vertical</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Switches separator orientation to a vertical dividing line.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>direction</PaperCode></td>
                            <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                            <td><PaperCode>"horizontal"</PaperCode></td>
                            <td>Orientation axis definition.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>orientation</PaperCode></td>
                            <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                            <td><PaperCode>"horizontal"</PaperCode></td>
                            <td>Alias for the direction prop.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Horizontal separators span 100% width with 1px height.
                Vertical separators span 100% height with 1px width.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Separate secondary actions inside toolbars.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="half" align="center">
    <PaperButton size="tiny">Back</PaperButton>
    <PaperSeparator vertical />
    <PaperButton size="tiny">Forward</PaperButton>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperButton size="tiny">Back</PaperButton>
                    <PaperSeparator vertical />
                    <PaperButton size="tiny">Forward</PaperButton>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
