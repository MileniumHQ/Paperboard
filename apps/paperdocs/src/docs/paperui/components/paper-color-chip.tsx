import { For, createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperColorChip,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const COLORS = [
    { color: "primary", name: "Blue" },
    { color: "extra-2", name: "Purple" },
    { color: "danger", name: "Red" },
    { color: "warning", name: "Yellow" },
    { color: "success", name: "Green" },
] as const;

export default function PaperColorChipDoc() {
    const [picked, setPicked] = createSignal<string>("primary");
    const [tag, setTag] = createSignal<string>("success");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperColorChip</PaperText>
            <PaperText preset="body" as="p">
                PaperColorChip is a color to pick: a filled circle, ringed in the action color when it's the selected one, with space between the fill and the ring.
                An icon can sit on the fill, and text turns the circle into a pill.
                Use a row of them wherever someone picks a color.
                For a color that only marks something, use <PaperLink href="/docs/paperui/paperswatch/">PaperSwatch</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                A chip does not keep its own state.
                Pass <PaperCode>selected</PaperCode> from a signal and set the signal in <PaperCode>onClick</PaperCode>.
                A chip with only a color has no text, so give it an <PaperCode>aria-label</PaperCode> naming the color.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="threefourths" align="center" wrap role="group" aria-label="Color">
                    <For each={COLORS}>
                        {(c) => (
                            <PaperColorChip
                                color={c.color}
                                selected={picked() === c.color}
                                aria-label={c.name}
                                title={c.name}
                                onClick={() => setPicked(c.color)}
                            />
                        )}
                    </For>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { For, createSignal } from "solid-js";
import { PaperColorChip, PaperFlex } from "@mileniumhq/paperui";

const COLORS = [
    { color: "primary", name: "Blue" },
    { color: "extra-2", name: "Purple" },
    { color: "danger", name: "Red" },
    { color: "warning", name: "Yellow" },
    { color: "success", name: "Green" },
] as const;

export function Example() {
    const [picked, setPicked] = createSignal<string>("primary");

    return (
        <PaperFlex direction="row" gap="threefourths" align="center" wrap role="group" aria-label="Color">
            <For each={COLORS}>
                {(c) => (
                    <PaperColorChip
                        color={c.color}
                        selected={picked() === c.color}
                        aria-label={c.name}
                        title={c.name}
                        onClick={() => setPicked(c.color)}
                    />
                )}
            </For>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperColorChipProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode> without <PaperCode>children</PaperCode> and <PaperCode>color</PaperCode>, which it declares itself.
                Other props, such as <PaperCode>onClick</PaperCode> and <PaperCode>aria-label</PaperCode>, land on the <PaperCode>button</PaperCode>.
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
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>Required</td>
                        <td>The fill: a color token or a CSS color, read the way <PaperLink href="/docs/paperui/paperswatch/">PaperSwatch</PaperLink> reads it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>selected</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Rings the chip in the action color and sets <PaperCode>aria-pressed</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A glyph on the fill. A string is a Material Symbols name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Text on the fill. With it, the circle becomes a pill.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Dims the chip and stops clicks.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The ring sits outside the fill with a gap between, so the gap shows whatever is behind the chip on any surface.</li>
                <li>The ring reaches past the chip's box, so space a row of chips with at least <PaperCode>gap="threefourths"</PaperCode> to keep it clear of the next chip.</li>
                <li>Hovering a chip that isn't selected shows a neutral ring, so it's clear it can be picked.</li>
                <li>The keyboard focus ring goes outside the selection ring, so the two never read as one.</li>
                <li>Text and icons on the fill use the on-color token, the same as a filled button.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="icon-and-text">With an icon and text</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="threefourths" align="center" wrap>
                    <PaperColorChip color="success" icon="check" selected={tag() === "success"} onClick={() => setTag("success")}>Done</PaperColorChip>
                    <PaperColorChip color="warning" icon="schedule" selected={tag() === "warning"} onClick={() => setTag("warning")}>Waiting</PaperColorChip>
                    <PaperColorChip color="danger" icon="star" aria-label="Urgent" selected={tag() === "danger"} onClick={() => setTag("danger")} />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="threefourths" align="center" wrap>
    <PaperColorChip color="success" icon="check" selected={tag() === "success"} onClick={() => setTag("success")}>Done</PaperColorChip>
    <PaperColorChip color="warning" icon="schedule" selected={tag() === "warning"} onClick={() => setTag("warning")}>Waiting</PaperColorChip>
    <PaperColorChip color="danger" icon="star" aria-label="Urgent" selected={tag() === "danger"} onClick={() => setTag("danger")} />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A color that marks something and does nothing when clicked is <PaperLink href="/docs/paperui/paperswatch/">PaperSwatch</PaperLink>.</li>
                <li>A filter or view switch without a color of its own is <PaperLink href="/docs/paperui/paperchip/">PaperChip</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
