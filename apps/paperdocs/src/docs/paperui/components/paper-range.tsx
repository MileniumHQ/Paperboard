import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperRange,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperRangeDoc() {
    const [volume, setVolume] = createSignal(40);
    const [memory, setMemory] = createSignal(4);
    const [level, setLevel] = createSignal(2);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperRange</PaperText>
            <PaperText preset="body" as="p">
                PaperRange is a slider for choosing a number within a span by dragging or with the keyboard.
                Use it for a setting where the position matters more than the exact digits, such as memory, volume, or a limit.
                For an exact number, use <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink>, and for showing progress without input, <PaperLink href="/docs/paperui/paperprogress/">PaperProgress</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>value</PaperCode> is required and the slider keeps no state of its own.
                Write the new value back in <PaperCode>onInput</PaperCode>, or the thumb snaps back.
                Set a name with <PaperCode>label</PaperCode> or <PaperCode>aria-label</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex width="field-wide">
                    <PaperRange
                        label="Volume"
                        value={volume()}
                        formatValue={(n) => `${n}%`}
                        onInput={setVolume}
                    />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperRange } from "@mileniumhq/paperui";

export function Example() {
    const [volume, setVolume] = createSignal(40);

    return (
        <PaperFlex width="field-wide">
            <PaperRange
                label="Volume"
                value={volume()}
                formatValue={(n) => \`\${n}%\`}
                onInput={setVolume}
            />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperRangeProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>onInput</PaperCode> and <PaperCode>onChange</PaperCode>, which it redefines.
                Other props land on the slider's <PaperCode>div</PaperCode>, after its ARIA attributes, so you can override them.
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
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The current value. A value outside the span is drawn clamped to it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>min</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>0</PaperCode></td>
                        <td>The lowest value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>max</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>min + 100</PaperCode></td>
                        <td>The highest value. A <PaperCode>max</PaperCode> that is not above <PaperCode>min</PaperCode> is replaced by <PaperCode>min + 100</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>step</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>1</PaperCode></td>
                        <td>The interval that pointer and key input snap to, counted from <PaperCode>min</PaperCode>. A step of 0 or less is read as 1. Float error is rounded away at the step's decimal places.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>orientation</PaperCode></td>
                        <td><PaperCode>PaperRangeOrientation</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode> or <PaperCode>"vertical"</PaperCode>. A vertical slider grows from the bottom up and draws no <PaperCode>label</PaperCode>, <PaperCode>formatValue</PaperCode> text, or marks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onInput</PaperCode></td>
                        <td><PaperCode>(value: number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called on every change while dragging, including the first press, and on each key press.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(value: number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called once when a drag ends, and on each key press. Use it to save.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A caption above the track, and the slider's accessible name unless you set <PaperCode>aria-label</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>formatValue</PaperCode></td>
                        <td><PaperCode>(value: number) =&gt; string</PaperCode></td>
                        <td>No default</td>
                        <td>Shows the current value, formatted, above the right end of the track. It also becomes the spoken value unless <PaperCode>valueText</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>valueText</PaperCode></td>
                        <td><PaperCode>(value: number) =&gt; string</PaperCode></td>
                        <td>No default</td>
                        <td>The text assistive technology reads for the value. Without it and without <PaperCode>formatValue</PaperCode>, the number is read.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>marks</PaperCode></td>
                        <td><PaperCode>PaperRangeMark[]</PaperCode></td>
                        <td>No default</td>
                        <td>Ticks under a horizontal track. Each is a number, or an object with a <PaperCode>value</PaperCode> and an optional <PaperCode>label</PaperCode> printed under its tick. Marks outside the span are dropped. Ticks at or below the value are drawn as reached.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>snapToMarks</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Makes only the marks selectable: dragging snaps to the nearest mark, and the arrow keys move between marks. Without any marks in the span it does nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Ignores pointer and keys, leaves the tab order, and sets <PaperCode>aria-disabled</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tabIndex</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>0</PaperCode></td>
                        <td>The slider's tab order. A disabled slider is always <PaperCode>-1</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the slider.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The types are exported from <PaperCode>@mileniumhq/paperui</PaperCode>:
            </PaperText>
            <PaperCode block language="ts">
{`type PaperRangeOrientation = "horizontal" | "vertical";
type PaperRangeMark = number | { value: number; label?: JSX.Element | string };`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="clamp-to-step">clampToStep</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>clampToStep(value, min, max, step)</PaperCode> is the function the slider uses to snap, also exported.
                It returns <PaperCode>value</PaperCode> rounded to the nearest step counted from the lower bound, clamped between the bounds, with float drift removed.
                A <PaperCode>step</PaperCode> of 0 or less skips the snapping and only clamps.
            </PaperText>
            <PaperCode block language="ts">
{`import { clampToStep } from "@mileniumhq/paperui";

clampToStep(7.3, 0, 10, 5); // 5
clampToStep(0.1 + 0.2, 0, 1, 0.1); // 0.3
clampToStep(120, 0, 100, 1); // 100`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="pointer">Pointer</PaperText>
            <PaperTextList>
                <li>Pressing the primary button anywhere on the slider sets the value under the pointer and starts a drag. Dragging continues outside the slider until release.</li>
                <li>A horizontal slider reads the pointer's position along the track from left to right. A vertical one reads it from the bottom up.</li>
                <li>Values snap to <PaperCode>step</PaperCode> and stay inside the span.</li>
                <li>On a device with haptics, crossing a stop during a drag gives a light tick, as long as the span has at most 24 stops or <PaperCode>snapToMarks</PaperCode> is on.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Right and Up arrows</td>
                        <td>Raise the value by one step, or move to the next mark with <PaperCode>snapToMarks</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Left and Down arrows</td>
                        <td>Lower the value by one step, or move to the previous mark.</td>
                    </tr>
                    <tr>
                        <td>Page Up and Page Down</td>
                        <td>Move by a tenth of the span, but at least one step. With <PaperCode>snapToMarks</PaperCode> they move three marks.</td>
                    </tr>
                    <tr>
                        <td>Home and End</td>
                        <td>Jump to the lowest and highest value.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Each key press calls both <PaperCode>onInput</PaperCode> and <PaperCode>onChange</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="accessibility">Accessibility</PaperText>
            <PaperTextList>
                <li>The slider has <PaperCode>role="slider"</PaperCode> with <PaperCode>aria-valuemin</PaperCode>, <PaperCode>aria-valuemax</PaperCode>, <PaperCode>aria-valuenow</PaperCode>, and <PaperCode>aria-orientation</PaperCode>. <PaperCode>aria-valuetext</PaperCode> comes from <PaperCode>valueText</PaperCode> or <PaperCode>formatValue</PaperCode>.</li>
                <li>The caption and value text drawn above the track are hidden from assistive technology, because the name and value are already announced from the attributes.</li>
                <li>The ticks and their labels are also hidden from assistive technology. Use <PaperCode>valueText</PaperCode> to give marked values readable names.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="save-on-release">Preview while dragging, save on release</PaperText>
            <PaperText preset="body" as="p">
                Keep a draft that follows <PaperCode>onInput</PaperCode>, and store the value in <PaperCode>onChange</PaperCode>.
                The gameserver panel's settings sliders work this way.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperQuote, PaperRange } from "@mileniumhq/paperui";

export function Setting(props: { stored: number; save: (value: number) => Promise<void> }) {
    const [draft, setDraft] = createSignal<number | null>(null);
    const [error, setError] = createSignal("");

    async function commit(value: number) {
        try {
            await props.save(value);
            setError("");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        setDraft(null);
    }

    return (
        <PaperFlex direction="column" gap="half" width="field-wide">
            <PaperRange
                label="Players"
                min={1}
                max={20}
                value={draft() ?? props.stored}
                onInput={setDraft}
                onChange={(value) => void commit(value)}
            />
            {error() ? <PaperQuote variant="danger">{error()}</PaperQuote> : null}
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="marks">Labelled marks that the value snaps to</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex width="field-wide">
                    <PaperRange
                        label="Memory"
                        min={1}
                        max={8}
                        value={memory()}
                        formatValue={(n) => `${n} GB`}
                        marks={[{ value: 1, label: "1" }, { value: 4, label: "4" }, { value: 8, label: "8" }]}
                        snapToMarks
                        onInput={setMemory}
                    />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperRange } from "@mileniumhq/paperui";

export function Memory() {
    const [memory, setMemory] = createSignal(4);

    return (
        <PaperFlex width="field-wide">
            <PaperRange
                label="Memory"
                min={1}
                max={8}
                value={memory()}
                formatValue={(n) => \`\${n} GB\`}
                marks={[{ value: 1, label: "1" }, { value: 4, label: "4" }, { value: 8, label: "8" }]}
                snapToMarks
                onInput={setMemory}
            />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="vertical">Vertical</PaperText>
            <PaperText preset="body" as="p">
                A vertical slider is three small controls tall by default.
                Give it a different height with a class, which wins over the default.
                Name it with <PaperCode>aria-label</PaperCode>, since it draws no caption.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperRange orientation="vertical" aria-label="Level" min={0} max={4} value={level()} onInput={setLevel} />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperRange } from "@mileniumhq/paperui";

export function Level() {
    const [level, setLevel] = createSignal(2);

    return <PaperRange orientation="vertical" aria-label="Level" min={0} max={4} value={level()} onInput={setLevel} />;
}`}
            </PaperCode>
        </PaperFlex>
    );
}
