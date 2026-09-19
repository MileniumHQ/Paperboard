import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSpacer,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperSpacerDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSpacer</PaperText>
            <PaperText preset="body">
                PaperSpacer introduces empty layout distance along a horizontal or vertical axis using spacing tokens.
                Reach for PaperSpacer when adding breathing room between disparate control groups without inline CSS margins.
                The spacer translates token names into precise pixel values.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Insert PaperSpacer between elements and set the size prop to a spacing token.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSpacer, PaperCard, PaperFlex, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column">
                <PaperText preset="body">Upper content</PaperText>
                <PaperSpacer size="double" />
                <PaperText preset="body">Lower content separated by double spacing</PaperText>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column">
                    <PaperText preset="body">Upper content</PaperText>
                    <PaperSpacer size="double" />
                    <PaperText preset="body">Lower content separated by double spacing</PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSpacer accepts distance and orientation properties:
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
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>PaperSpacing</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Spacing distance: onefourth, half, full, double, triple, quadruple.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>direction</PaperCode></td>
                            <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                            <td><PaperCode>"vertical"</PaperCode></td>
                            <td>Layout axis defining whether height or width is expanded.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperSpacer renders a block div assigning the CSS custom property --spacer-size.
                In horizontal orientation, the spacer expands width while height remains zero.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use horizontal spacers to separate button bars.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" align="center">
    <PaperText preset="body">Left item</PaperText>
    <PaperSpacer direction="horizontal" size="double" />
    <PaperText preset="body">Right item</PaperText>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" align="center">
                    <PaperText preset="body">Left item</PaperText>
                    <PaperSpacer direction="horizontal" size="double" />
                    <PaperText preset="body">Right item</PaperText>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
