import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSwatch,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperSwatchDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperSwatch</PaperText>
            <PaperText preset="body">
                PaperSwatch renders a circular color dot for role indicators, palette swatches, and presence markers.
                Reach for PaperSwatch when presenting server connection statuses, theme palette previews, or activity lights.
                The dot displays a subtle inset border to maintain boundary clarity on bright surfaces.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass any CSS color string or design token to the color prop.
                Adjust dimensions using the size prop.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSwatch, PaperCard, PaperFlex, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperSwatch color="var(--paper-success)" />
                    <PaperText size={2}>Online</PaperText>
                </PaperFlex>
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperSwatch color="var(--paper-danger)" />
                    <PaperText size={2}>Offline</PaperText>
                </PaperFlex>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperSwatch color="var(--paper-success)" />
                        <PaperText size={2}>Online</PaperText>
                    </PaperFlex>
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperSwatch color="var(--paper-danger)" />
                        <PaperText size={2}>Offline</PaperText>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperSwatch accepts the following properties:
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
                            <td><PaperCode>color</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"var(--paper-border)"</PaperCode></td>
                            <td>Background color value. Supports hex codes, rgb, or CSS token variables.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>"small" | "medium" | "large"</PaperCode></td>
                            <td><PaperCode>"medium"</PaperCode></td>
                            <td>Diameter size: small (8px), medium (12px), large (16px).</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperSwatch renders an inline-block span element with circular border-radius.
                The border uses an alpha stroke to ensure visibility over contrasting backgrounds.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Compare dot sizes next to each other.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center">
    <PaperSwatch size="small" color="var(--paper-primary)" />
    <PaperSwatch size="medium" color="var(--paper-primary)" />
    <PaperSwatch size="large" color="var(--paper-primary)" />
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperSwatch size="small" color="var(--paper-primary)" />
                    <PaperSwatch size="medium" color="var(--paper-primary)" />
                    <PaperSwatch size="large" color="var(--paper-primary)" />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
