import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperGrid,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperGridDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperGrid</PaperText>
            <PaperText preset="body">
                PaperGrid arranges elements into a responsive CSS grid without inline column styles.
                Reach for PaperGrid when displaying dashboard widgets, media card galleries, or metric tiles.
                The layout supports auto-fill track sizing based on a minimum cell width or fixed column counts.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place child elements directly inside PaperGrid.
                Use the min prop to define the smallest allowable column size before wrapping occurs.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperGrid, PaperCard, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperGrid min="140px">
                <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 1</PaperText></PaperCard>
                <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 2</PaperText></PaperCard>
                <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 3</PaperText></PaperCard>
            </PaperGrid>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperGrid min="140px">
                    <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 1</PaperText></PaperCard>
                    <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 2</PaperText></PaperCard>
                    <PaperCard padding="full" surface="frontest"><PaperText preset="body">Tile 3</PaperText></PaperCard>
                </PaperGrid>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperGrid accepts track definition properties:
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
                            <td><PaperCode>min</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"var(--paper-grid-min)"</PaperCode></td>
                            <td>Minimum track size for repeat(auto-fill, minmax(min, 1fr)). Default is 200px.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>columns</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Fixed column count. Overrides the auto-fill min calculation when set.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When columns is omitted, the grid wraps tracks automatically as container width decreases.
                The grid gap inherits the standard spacing token var(--paper-uigap).
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Set a fixed column count for multi-column comparison tables or forms.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperGrid columns={2}>
    <PaperCard padding="full" surface="front"><PaperText preset="body">Column 1</PaperText></PaperCard>
    <PaperCard padding="full" surface="front"><PaperText preset="body">Column 2</PaperText></PaperCard>
</PaperGrid>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperGrid columns={2}>
                    <PaperCard padding="full" surface="front"><PaperText preset="body">Column 1</PaperText></PaperCard>
                    <PaperCard padding="full" surface="front"><PaperText preset="body">Column 2</PaperText></PaperCard>
                </PaperGrid>
            </PaperCard>
        </PaperFlex>
    );
}
