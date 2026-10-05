import {
    PaperBadge,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperBadgeDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperBadge</PaperText>
            <PaperText preset="body">
                PaperBadge renders a compact status indicator or label tag with semantic role colors.
                Reach for PaperBadge when labeling entity types, counting items, or indicating lifecycle states.
                The badge supports leading icons and colored role variants.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place text or counts inside PaperBadge children.
                Pass an optional semantic variant to tint the background and text colors.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperBadge>Monochrome</PaperBadge>
                <PaperBadge variant="primary">Primary</PaperBadge>
                <PaperBadge variant="success">Success</PaperBadge>
                <PaperBadge variant="danger">Danger</PaperBadge>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperBadge>Monochrome</PaperBadge>
                    <PaperBadge variant="primary">Primary</PaperBadge>
                    <PaperBadge variant="success">Success</PaperBadge>
                    <PaperBadge variant="danger">Danger</PaperBadge>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperBadge accepts variant and icon props alongside standard span attributes.
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
                            <td><PaperCode>variant</PaperCode></td>
                            <td><PaperCode>PaperBadgeVariant</PaperCode></td>
                            <td><PaperCode>"monochrome"</PaperCode></td>
                            <td>Semantic color role: monochrome, primary, brand, success, danger, warning, attention, extra-1, extra-2, extra-3.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon rendered before badge text. String values render via PaperIcon.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperBadge uses inline-flex display with centered alignment.
                String icons render with zero height to prevent line-height distortion.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Add icons to badges to provide categorical context.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperBadge variant="success" icon="check">Verified</PaperBadge>
    <PaperBadge variant="warning" icon="warning">Pending</PaperBadge>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperBadge variant="success" icon="check">Verified</PaperBadge>
                    <PaperBadge variant="warning" icon="warning">Pending</PaperBadge>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
