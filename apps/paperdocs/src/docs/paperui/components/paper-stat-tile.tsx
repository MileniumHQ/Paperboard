import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperGrid,
    PaperLink,
    PaperStatTile,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperStatTileDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperStatTile</PaperText>
            <PaperText preset="body" as="p">
                PaperStatTile shows one metric: an icon, a large value, a label, and an optional meter.
                Use it for a row of readings such as health, memory, or players online.
                For a list of many labelled values, use <PaperLink href="/docs/paperui/paperkeyvaluelist/">PaperKeyValueList</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>label</PaperCode> and <PaperCode>value</PaperCode> are required.
                Lay several tiles out with <PaperLink href="/docs/paperui/papergrid/">PaperGrid</PaperLink>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperGrid min="field">
                    <PaperStatTile icon="favorite" label="Health" value="18" tone="danger" meter={{ value: 18, max: 20 }} />
                    <PaperStatTile icon="restaurant" label="Food" value="12" tone="warning" meter={{ value: 12, max: 20 }} />
                    <PaperStatTile icon="group" label="Players" value="4" />
                </PaperGrid>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperGrid, PaperStatTile } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperGrid min="field">
            <PaperStatTile icon="favorite" label="Health" value="18" tone="danger" meter={{ value: 18, max: 20 }} />
            <PaperStatTile icon="restaurant" label="Food" value="12" tone="warning" meter={{ value: 12, max: 20 }} />
            <PaperStatTile icon="group" label="Players" value="4" />
        </PaperGrid>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperStatTileProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the tile's <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The reading, in large bold text. Format numbers yourself. Render the tile only when a reading exists.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>What the value measures, in small subdued text under it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>A leading icon. A string is a Material icon name. An element is placed unchanged.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tone</PaperCode></td>
                        <td><PaperCode>PaperRole</PaperCode></td>
                        <td>No default (neutral)</td>
                        <td>Tints the icon with the role's deep color, and the meter unless the meter sets its own variant. One of <PaperCode>"primary"</PaperCode>, <PaperCode>"brand"</PaperCode>, <PaperCode>"success"</PaperCode>, <PaperCode>"danger"</PaperCode>, <PaperCode>"warning"</PaperCode>, <PaperCode>"attention"</PaperCode>, <PaperCode>"extra-1"</PaperCode>, <PaperCode>"extra-2"</PaperCode>, or <PaperCode>"extra-3"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>meter</PaperCode></td>
                        <td><PaperCode>PaperStatTileMeter</PaperCode></td>
                        <td>No default (no meter)</td>
                        <td>A <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink> bar under the label. See PaperStatTileMeter.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the tile. An object <PaperCode>style</PaperCode> is merged after the component's own.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="meter">PaperStatTileMeter</PaperText>
            <PaperText preset="body" as="p">
                The shape of <PaperCode>meter</PaperCode>, exported from <PaperCode>@mileniumhq/paperui</PaperCode>:
            </PaperText>
            <PaperCode block language="ts">
{`interface PaperStatTileMeter {
    value: number; // how much, from 0 to max
    max: number; // the value that fills the bar
    variant?: PaperRole; // the bar's color, defaulting to the tile's tone
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The tile is a raised, bordered box that takes the width of its cell.</li>
                <li>The tile is not interactive. For a clickable summary, use <PaperLink href="/docs/paperui/papermediacard/">PaperMediaCard</PaperLink>.</li>
                <li>The meter follows <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink>: <PaperCode>value</PaperCode> is clamped to the bar, a <PaperCode>max</PaperCode> of 0 or less is read as 100, and it is a <PaperCode>progressbar</PaperCode> with no name of its own. The value and label above it carry the meaning.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="live-readings">Readings that may be missing</PaperText>
            <PaperText preset="body" as="p">
                Render a tile only when its reading exists, and give the meter the same condition.
            </PaperText>
            <PaperCode block language="tsx">
{`import { Show } from "solid-js";
import { PaperGrid, PaperStatTile } from "@mileniumhq/paperui";

export function Vitals(props: { health: number | undefined }) {
    return (
        <PaperGrid min="field">
            <Show when={props.health !== undefined}>
                <PaperStatTile
                    icon="favorite"
                    label="Health"
                    value={String(props.health)}
                    tone="danger"
                    meter={{ value: props.health!, max: 20 }}
                />
            </Show>
        </PaperGrid>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
