import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperProgress,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperProgressDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperProgress</PaperText>
            <PaperText preset="body">
                PaperProgress renders a horizontal linear meter displaying determinate completion or indeterminate activity.
                Reach for PaperProgress when visualizing file upload progress, CPU load levels, or task durations.
                The bar renders accessible progressbar roles and clamps percentages between bounds.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass a numeric value prop for determinate percentage displays.
                Omit the value prop to trigger the continuous indeterminate animation.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperProgress, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperProgress value={45} />
                <PaperProgress value={80} max={100} />
                <PaperProgress value={30} variant="success" />
                <PaperProgress />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperProgress value={45} />
                    <PaperProgress value={80} max={100} />
                    <PaperProgress value={30} variant="success" />
                    <PaperProgress />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperProgress accepts value and scale configurations:
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
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Current numerical progress. When omitted, the bar displays an indeterminate pulse.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>max</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>100</PaperCode></td>
                            <td>Upper bound value defining 100% completion.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>variant</PaperCode></td>
                            <td><PaperCode>PaperRole</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Fill color role. Defaults to the primary action color.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperProgress exposes aria-valuenow, aria-valuemin, and aria-valuemax attributes to assistive devices.
                Values exceeding the max boundary are clamped to 100% width.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Track download progress by pairing PaperProgress with numerical readouts.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="half">
    <PaperText size={2}>Downloading: 75%</PaperText>
    <PaperProgress value={75} />
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="half">
                    <PaperText size={2}>Downloading: 75%</PaperText>
                    <PaperProgress value={75} />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
