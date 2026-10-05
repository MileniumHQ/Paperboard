import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSectionHeader,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperSectionHeaderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSectionHeader</PaperText>
            <PaperText preset="body">
                PaperSectionHeader renders a list partition header featuring an icon, title, count badge, and action controls.
                Reach for PaperSectionHeader when dividing long lists, organizing card groups, or partitioning settings drawers.
                The header aligns leading metadata with trailing inline tool actions.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass title and count props to label the section.
                Render supplementary controls inside the children slot.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSectionHeader, PaperButton, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperSectionHeader icon="extension" title="Installed panels" count={5}>
                <PaperButton size="tiny">Manage</PaperButton>
            </PaperSectionHeader>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperSectionHeader icon="extension" title="Installed panels" count={5}>
                    <PaperButton size="tiny">Manage</PaperButton>
                </PaperSectionHeader>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSectionHeader accepts the following configuration properties:
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
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td>No default</td>
                            <td>Section title text.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon glyph name or custom element.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>count</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Numerical count displayed in a monochrome badge beside the title.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperSectionHeader formats the title row with bold typography and subtle border separators.
                Trailing action buttons align along the opposite edge.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Omit the count prop when categorizing uncounted settings.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperSectionHeader icon="palette" title="Appearance" />`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperSectionHeader icon="palette" title="Appearance" />
            </PaperCard>
        </PaperFlex>
    );
}
