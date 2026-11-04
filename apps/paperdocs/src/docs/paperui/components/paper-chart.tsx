import {
    PaperCard,
    PaperChart,
    PaperChartLegend,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const memory = [
    { label: "Used", value: 6.2, detail: "6.2 GB" },
    { label: "Cached", value: 3.1, detail: "3.1 GB" },
];

export default function PaperChartDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperChart</PaperText>
            <PaperText preset="body" as="p">
                PaperChart draws a small chart: parts of a whole as a donut or a bar, or readings over time as a line.
                Use it for a memory split, a disk bar, or a CPU trend in a widget or a status card.
                PaperChartLegend names the parts of a donut or bar beside it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass a <PaperCode>label</PaperCode> that says what the chart measures and the <PaperCode>segments</PaperCode>.
                The default <PaperCode>type</PaperCode> is <PaperCode>"donut"</PaperCode>.
                A donut fills the width it is given and stays square, so set the size on a parent.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="double" align="center">
                    <PaperFlex width="field">
                        <PaperChart label="Memory" segments={memory} total={16}>
                            <PaperText preset="title" as="p">9.3 GB</PaperText>
                        </PaperChart>
                    </PaperFlex>
                    <PaperChartLegend segments={memory} total={16} />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperChart, PaperChartLegend, PaperFlex, PaperText } from "@mileniumhq/paperui";

const memory = [
    { label: "Used", value: 6.2, detail: "6.2 GB" },
    { label: "Cached", value: 3.1, detail: "3.1 GB" },
];

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="double" align="center">
                <PaperFlex width="field">
                    <PaperChart label="Memory" segments={memory} total={16}>
                        <PaperText preset="title" as="p">9.3 GB</PaperText>
                    </PaperChart>
                </PaperFlex>
                <PaperChartLegend segments={memory} total={16} />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperChartProps is a union on <PaperCode>type</PaperCode>.
                Both forms extend <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>children</PaperCode>, and other props land on the root <PaperCode>div</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="common-props">Both forms</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>What the chart measures. With each part's reading it forms the accessible name: <PaperCode>Memory: Used 6.2 GB, Cached 3.1 GB</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"donut" | "bar" | "line"</PaperCode></td>
                        <td><PaperCode>"donut"</PaperCode></td>
                        <td>Chooses the form. <PaperCode>"line"</PaperCode> requires <PaperCode>series</PaperCode>; the others require <PaperCode>segments</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="parts-props">Donut and bar</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>segments</PaperCode></td>
                        <td><PaperCode>PaperChartSegment[]</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The parts, in drawing order.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>total</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The sum of the segments</td>
                        <td>The whole the segments are parts of. The unused remainder stays empty. A total smaller than the sum is ignored, so the parts never draw past the whole.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>thickness</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>12</PaperCode></td>
                        <td>Ring thickness in hundredths of the donut's width, clamped to 1 through 50. Donut only.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Content centered in the donut's hole, such as the total as text. Donut only.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                PaperChartSegment:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The part's name, used in the accessible name and the legend.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The part's size. A negative or non-finite value counts as 0.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>The next palette color</td>
                        <td>A role, a token, or a CSS color. The palette, in order, is <PaperCode>primary</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-3</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>success</PaperCode>, then it repeats. A chart and its legend agree without being told.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detail</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The share, such as <PaperCode>"14%"</PaperCode></td>
                        <td>The reading as people say it, such as <PaperCode>"1.2 GB"</PaperCode>. Shares under 1 percent read <PaperCode>"&lt;1%"</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="line-props">Line</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>series</PaperCode></td>
                        <td><PaperCode>PaperChartSeries[]</PaperCode></td>
                        <td>Required, no default</td>
                        <td>One line per series.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>min</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>0</PaperCode></td>
                        <td>The value at the bottom of the chart. Readings below it are clamped to it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>max</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The largest reading</td>
                        <td>The value at the top. Readings above it are clamped to it. Set it for a fixed scale, such as 100 for a percentage.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>span</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The longest series</td>
                        <td>How many readings wide the chart is (at least 2). A shorter series draws from the right edge, as a live graph fills in. A series longer than the span shows its newest readings.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fill</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Tints the area under each line.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                PaperChartSeries:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The series' name, used in the accessible name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>values</PaperCode></td>
                        <td><PaperCode>number[]</PaperCode></td>
                        <td>Required, no default</td>
                        <td>Readings, oldest first. Non-finite values are dropped.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>The next palette color</td>
                        <td>A role, a token, or a CSS color.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detail</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The last value</td>
                        <td>The latest reading as people say it, such as <PaperCode>"58%"</PaperCode>, for the accessible name.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="legend-props">PaperChartLegend</PaperText>
            <PaperText preset="body" as="p">
                PaperChartLegend renders a <PaperCode>ul</PaperCode> and extends <PaperCode>JSX.HTMLAttributes&lt;HTMLUListElement&gt;</PaperCode>.
                Give it the same <PaperCode>segments</PaperCode> and <PaperCode>total</PaperCode> as the chart so the colors and readings agree.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>segments</PaperCode></td>
                        <td><PaperCode>PaperChartSegment[]</PaperCode></td>
                        <td>Required, no default</td>
                        <td>One row per segment: a swatch, the label, and the reading.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>total</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The sum of the segments</td>
                        <td>Used to compute each share when a segment has no <PaperCode>detail</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Shows names only, without readings, where there is no room.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The chart is one element with <PaperCode>role="img"</PaperCode> and the generated accessible name. Its drawing is hidden from assistive technology, so the readings live in <PaperCode>label</PaperCode> and each <PaperCode>detail</PaperCode>.</li>
                <li>A donut ring starts at twelve o'clock. A share of about 1.6 percent or less is left off the ring, since it would draw as a hairline; the legend and the accessible name still name it. A bar always draws a part with a positive share, at a minimum width.</li>
                <li>A donut is as wide as its parent and square. Size it with a wrapping <PaperCode>PaperFlex</PaperCode> <PaperCode>width</PaperCode>.</li>
                <li>A bar is full width and a fixed thin height. A line is full width and four spacing units tall (<PaperCode>--paper-uigap</PaperCode> times 4), with a hairline under it. A line stretches to its box, but its stroke keeps its width.</li>
                <li>A line with one reading draws nothing yet: it needs two or more.</li>
                <li>Changing <PaperCode>segments</PaperCode> animates the slice and the bar widths, unless the user prefers reduced motion.</li>
                <li>The chart does not show tooltips or axis labels. Put the numbers people need in <PaperCode>detail</PaperCode>, the donut's center, or text beside it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="bar">Disk bar</PaperText>
            <PaperCard data-docs-demo padding="double" gap="full" surface="front">
                <PaperChart
                    type="bar"
                    label="Disk"
                    total={100}
                    segments={[
                        { label: "Worlds", value: 42, detail: "42 GB" },
                        { label: "Backups", value: 18, detail: "18 GB" },
                    ]}
                />
                <PaperChartLegend
                    total={100}
                    segments={[
                        { label: "Worlds", value: 42, detail: "42 GB" },
                        { label: "Backups", value: 18, detail: "18 GB" },
                    ]}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperChart, PaperChartLegend } from "@mileniumhq/paperui";

const disk = [
    { label: "Worlds", value: 42, detail: "42 GB" },
    { label: "Backups", value: 18, detail: "18 GB" },
];

<PaperCard padding="double" gap="full" surface="front">
    <PaperChart type="bar" label="Disk" total={100} segments={disk} />
    <PaperChartLegend total={100} segments={disk} />
</PaperCard>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="line">Trend over time</PaperText>
            <PaperText preset="body" as="p">
                Pin the scale with <PaperCode>min</PaperCode> and <PaperCode>max</PaperCode>, and set <PaperCode>span</PaperCode> to the number of readings you keep so a new series fills in from the right.
                The botcreator panel's widget charts commands per hour this way.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperChart
                    type="line"
                    label="CPU"
                    min={0}
                    max={100}
                    span={12}
                    fill
                    series={[{ label: "In use", values: [12, 18, 15, 30, 42, 38, 55, 61, 48, 52], detail: "52%" }]}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperChart } from "@mileniumhq/paperui";

<PaperCard padding="double" surface="front">
    <PaperChart
        type="line"
        label="CPU"
        min={0}
        max={100}
        span={12}
        fill
        series={[{ label: "In use", values: [12, 18, 15, 30, 42, 38, 55, 61, 48, 52], detail: "52%" }]}
    />
</PaperCard>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink> for one value moving toward a goal.
                Use <PaperLink href="/docs/paperui/paperstattile/">PaperStatTile</PaperLink> for a single number with a caption.
                Use PaperChart when the shape of several parts, or of readings over time, is the point.
            </PaperText>
        </PaperFlex>
    );
}
