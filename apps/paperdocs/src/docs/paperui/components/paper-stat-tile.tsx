import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperGrid,
    PaperStatTile,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperStatTileDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperStatTile</PaperText>
            <PaperText preset="body">
                PaperStatTile renders a single metric readout: an icon chip, a value, a label, and an optional meter.
                Reach for PaperStatTile when laying out player, plugin, world, or service statistics.
                The tile is the shared building block behind stat panels so no panel hand-rolls its own tile.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass icon, label, and value. Add a tone to tint the icon chip, and an optional meter for bounded values such as health or food.
                Stack tiles in a PaperGrid to build responsive stat panels.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperStatTile, PaperGrid, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperGrid columns={3}>
                <PaperStatTile icon="favorite" label="Health" value="18 / 20" tone="danger" meter={{ value: 18, max: 20 }} />
                <PaperStatTile icon="restaurant" label="Food" value="16 / 20" tone="warning" meter={{ value: 16, max: 20 }} />
                <PaperStatTile icon="diamond" label="Blocks mined" value="48,210" />
            </PaperGrid>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperGrid columns={3}>
                    <PaperStatTile icon="favorite" label="Health" value="18 / 20" tone="danger" meter={{ value: 18, max: 20 }} />
                    <PaperStatTile icon="restaurant" label="Food" value="16 / 20" tone="warning" meter={{ value: 16, max: 20 }} />
                    <PaperStatTile icon="diamond" label="Blocks mined" value="48,210" />
                </PaperGrid>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperStatTile accepts content and tone properties alongside standard div attributes.
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
                            <td>Leading icon in the chip. String values render via PaperIcon.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>Caption under the value describing the metric.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>The metric readout, already formatted by the caller.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>tone</PaperCode></td>
                            <td><PaperCode>PaperRole</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Tints the icon chip and defaults the meter color.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>meter</PaperCode></td>
                            <td><PaperCode>{ "{ value, max, variant? }" }</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Optional bounded meter rendered under the value; variant overrides the tone.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The meter renders a PaperProgress, which exposes progressbar semantics to assistive devices.
                A tone sets the shared role variables on the tile, so the icon chip and meter stay in step.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Let the meter variant differ from the tile tone when the value is critical, such as low health.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperStatTile
    icon="favorite"
    label="Health"
    value="4 / 20"
    tone="warning"
    meter={{ value: 4, max: 20, variant: "danger" }}
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperStatTile
                    icon="favorite"
                    label="Health"
                    value="4 / 20"
                    tone="warning"
                    meter={{ value: 4, max: 20, variant: "danger" }}
                />
            </PaperCard>
        </PaperFlex>
    );
}
