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

const load = [12, 18, 15, 22, 41, 38, 30, 26, 35, 52, 47, 33];

export default function PaperChartDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperChart</PaperText>
            <PaperText preset="body">
                PaperChart draws a small chart: parts of a whole as a donut or a bar, or readings over time as a line.
                Reach for PaperChart when showing how memory, disk, or players split between a few things, or how one number has moved.
                PaperChartLegend names the parts of a donut or bar beside it.
            </PaperText>
            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass a label and the segments. Each segment has a label and a value. A total larger than their sum leaves the rest of the chart empty.
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
                The type prop picks the chart. Every type takes label and standard div attributes.
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
                        <td><PaperCode>"donut" | "bar" | "line"</PaperCode></td>
                        <td><PaperCode>"donut"</PaperCode></td>
                        <td>A ring with room in the middle, a flat bar, or lines over time.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>What the chart measures. It starts the chart's accessible name.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="subheader" id="donut-and-bar">Donut and bar</PaperText>
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
                        <td><PaperCode>segments</PaperCode></td>
                        <td><PaperCode>PaperChartSegment[]</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The parts, drawn in order.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>total</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>sum of the segments</td>
                        <td>The whole the segments are parts of. What is left over stays empty. A total smaller than the sum is ignored.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>thickness</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>12</PaperCode></td>
                        <td>Ring thickness of a donut, in hundredths of its width, from 1 to 50.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>no default</td>
                        <td>Shown in the middle of a donut.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                Each PaperChartSegment has these fields.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The part's name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>Its size. Negative values and values that are not numbers count as 0.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>next palette color</td>
                        <td>A role, a token, or any CSS color. The palette runs primary, extra-1, extra-2, attention, extra-3, warning, success, then repeats.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detail</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>its share, such as 14%</td>
                        <td>The reading as people say it, such as 6.2 GB.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                PaperChartLegend lists a swatch, a label and a reading for each segment. It accepts these props alongside standard ul attributes.
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
                        <td><PaperCode>segments</PaperCode></td>
                        <td><PaperCode>PaperChartSegment[]</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The same segments as the chart, so colors and readings agree.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>total</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>sum of the segments</td>
                        <td>The same total as the chart, so percentage readings agree.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Lists the names alone, for places too narrow for the readings.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="subheader" id="line">Line</PaperText>
            <PaperText preset="body">
                A line chart draws one line per series, oldest reading on the left. It fills the width it is given and is four gaps tall unless a height is set on it.
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
                        <td><PaperCode>series</PaperCode></td>
                        <td><PaperCode>PaperChartSeries[]</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The lines. Each has a label, values (oldest first), and an optional color and detail.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>min</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>0</PaperCode></td>
                        <td>The reading at the bottom of the chart.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>max</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>largest reading</td>
                        <td>The reading at the top of the chart.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>span</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>longest series</td>
                        <td>How many readings the chart is wide. A shorter series is drawn from the right edge, so a chart that is still collecting readings fills in toward the left.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fill</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Tints the area under each line.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`const load = [12, 18, 15, 22, 41, 38, 30, 26, 35, 52, 47, 33];

<PaperChart
    type="line"
    label="CPU over the last minute"
    series={[{ label: "In use", values: load, detail: "33%" }]}
    min={0}
    max={100}
    fill
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperChart
                    type="line"
                    label="CPU over the last minute"
                    series={[{ label: "In use", values: load, detail: "33%" }]}
                    min={0}
                    max={100}
                    fill
                />
            </PaperCard>
            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The chart is exposed to assistive devices as one image. Its name is the label followed by every segment's reading, or every series' latest reading.
                Segments never draw past the whole, and a share above zero but under one percent reads as &lt;1%.
                A line needs two readings before it is drawn. Readings outside min and max are drawn at the edge, and values that are not numbers are skipped.
                Donut and bar segments ease to their new size when values change, except under reduced motion.
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
