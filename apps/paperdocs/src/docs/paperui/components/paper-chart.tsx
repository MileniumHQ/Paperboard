import {
    PaperCard,
    PaperChart,
    PaperChartLegend,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

const memory = [
    { label: "Game Server", value: 6.2, detail: "6.2 GB" },
    { label: "AI", value: 3.1, detail: "3.1 GB" },
    { label: "Paperboard", value: 0.6, detail: "600 MB" },
];

export default function PaperChartDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperChart</PaperText>
            <PaperText preset="body">
                PaperChart draws parts of a whole as a donut or a bar.
                Reach for PaperChart when showing how memory, disk, players, or any other total splits between a few things.
                PaperChartLegend names the parts beside it.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass a label and the segments. Each segment has a label and a value; a total larger than their sum leaves the rest of the chart empty.
                A donut is as wide as its container, and its children are shown in the middle.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperChart, PaperChartLegend, PaperFlex, PaperText } from "@mileniumhq/paperui";

const memory = [
    { label: "Game Server", value: 6.2, detail: "6.2 GB" },
    { label: "AI", value: 3.1, detail: "3.1 GB" },
    { label: "Paperboard", value: 0.6, detail: "600 MB" },
];

export function Example() {
    return (
        <PaperFlex gap="double" align="center">
            <PaperChart label="Memory" segments={memory} total={16} style={{ width: "8rem" }}>
                <PaperText size={4} weight={800}>62%</PaperText>
            </PaperChart>
            <PaperChartLegend segments={memory} total={16} />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex gap="double" align="center">
                    <PaperChart label="Memory" segments={memory} total={16} style={{ width: "8rem" }}>
                        <PaperText size={4} weight={800}>62%</PaperText>
                    </PaperChart>
                    <PaperChartLegend segments={memory} total={16} />
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperChart accepts these properties alongside standard div attributes.
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
                            <td><PaperCode>type</PaperCode></td>
                            <td><PaperCode>"donut" | "bar"</PaperCode></td>
                            <td><PaperCode>"donut"</PaperCode></td>
                            <td>A ring with room in the middle, or a flat bar.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>segments</PaperCode></td>
                            <td><PaperCode>PaperChartSegment[]</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>The parts, drawn in order: label, value, and an optional color and detail.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>total</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td>sum of the segments</td>
                            <td>The whole the segments are parts of. What is left over stays empty.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>required</PaperCode></td>
                            <td>What the chart measures. Read aloud with each segment's reading.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>thickness</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>12</PaperCode></td>
                            <td>Ring thickness of a donut, in hundredths of its width.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Shown in the middle of a donut.</td>
                        </tr>
                    </tbody>
                </PaperTable>
            <PaperText preset="body">
                A segment's color is a role, a token, or any CSS color. Segments without one take the chart palette in order.
                Its detail is the reading as people say it, such as "6.2 GB"; without one the legend shows its share as a percentage.
                PaperChartLegend takes the same segments and total, so its colors and readings match the chart.
                Its compact prop lists the names alone, for places too narrow for the readings.
            </PaperText>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The chart is exposed to assistive devices as one image, named by its label and every segment's reading.
                Values that are negative or not numbers draw nothing, and segments never draw past the whole.
                Segments ease to their new size when values change, except under reduced motion.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use a bar when there is no room for a ring, such as inside a list row.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperChart type="bar" label="Memory" segments={memory} total={16} />`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperChart type="bar" label="Memory" segments={memory} total={16} />
                    <PaperChartLegend segments={memory} total={16} />
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
