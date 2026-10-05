import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperIcon,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperIconDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperIcon</PaperText>
            <PaperText preset="body">
                PaperIcon renders Material Symbols Rounded glyphs or external image icons with aligned metrics.
                Reach for PaperIcon when decorating buttons, menu items, table rows, and status indicators.
                The component normalizes font line-heights and supports zero-height baseline rendering.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass a Material Symbols icon name as text children.
                Pass an image URL through the src prop when rendering custom graphic assets.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperIcon, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperIcon>settings</PaperIcon>
                <PaperIcon>terminal</PaperIcon>
                <PaperIcon>favorite</PaperIcon>
                <PaperIcon zeroHeight>check</PaperIcon>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperIcon>settings</PaperIcon>
                    <PaperIcon>terminal</PaperIcon>
                    <PaperIcon>favorite</PaperIcon>
                    <PaperIcon zeroHeight>check</PaperIcon>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperIcon accepts the following rendering props:
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
                            <td><PaperCode>zeroHeight</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Collapses vertical line-height footprint so inline text remains on its baseline.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>monogram</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Applies rounded monogram typography treatment to character glyphs.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>src</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Image source URL rendered inside the icon container instead of ligature text.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>alt</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>""</PaperCode></td>
                            <td>Accessible image description when src is provided.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Material Symbols fonts load through local woff2 files bundled in PaperUI.
                Glyphs inherit current CSS font-size and color tokens from their parent container.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Inline icons within text paragraphs using zeroHeight.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperText preset="body">
    Status: <PaperIcon zeroHeight>check_circle</PaperIcon> Operational
</PaperText>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperText preset="body">
                    Status: <PaperIcon zeroHeight>check_circle</PaperIcon> Operational
                </PaperText>
            </PaperCard>
        </PaperFlex>
    );
}
