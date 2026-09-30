import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperRange,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperRangeDoc() {
    const [value, setValue] = createSignal(40);
    const [level, setLevel] = createSignal(0.6);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperRange</PaperText>
            <PaperText preset="body">
                PaperRange is a slider drawn with the track and bar of <PaperCode>PaperProgress</PaperCode>.
                Drag the bar, click the track, or use the keyboard to pick a number between two bounds.
                Reach for PaperRange for volume, zoom, opacity, or any setting that reads as a level.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                PaperRange is controlled: pass <PaperCode>value</PaperCode> and write the new value back from <PaperCode>onInput</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperRange, PaperText } from "@paperboard-dev/paperui";

export function Example() {
    const [value, setValue] = createSignal(40);

    return (
        <PaperCard padding="double" surface="front">
            <PaperRange aria-label="Level" value={value()} onInput={setValue} />
            <PaperText size={2}>Value: {value()}</PaperText>
        </PaperCard>
    );
}`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperRange aria-label="Level" value={value()} onInput={setValue} />
                <PaperText size={2}>Value: {value()}</PaperText>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperRange accepts the following props. Other props, including <PaperCode>aria-label</PaperCode>, pass through to the slider element.
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
                            <td>No default</td>
                            <td>Current value. Values outside the bounds draw clamped.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>min</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>0</PaperCode></td>
                            <td>Lower bound.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>max</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>min + 100</PaperCode></td>
                            <td>Upper bound. A <PaperCode>max</PaperCode> at or below <PaperCode>min</PaperCode> falls back to the default.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>step</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>1</PaperCode></td>
                            <td>Interval that pointer and keyboard values snap to.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>orientation</PaperCode></td>
                            <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                            <td><PaperCode>"horizontal"</PaperCode></td>
                            <td>Horizontal fills its width and grows left to right. Vertical is <PaperCode>--paper-control-size-small</PaperCode> times three tall and grows bottom to top. A class or <PaperCode>style</PaperCode> on the element overrides either length.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Ignores pointer and keyboard input and leaves the tab order.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onInput</PaperCode></td>
                            <td><PaperCode>(value: number) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Called on every change while dragging and on each key press.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onChange</PaperCode></td>
                            <td><PaperCode>(value: number) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Called once when a drag ends, and on each key press. Save settings here.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>valueText</PaperCode></td>
                            <td><PaperCode>(value: number) =&gt; string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Text that assistive technology reads for the value, for example <PaperCode>"60%"</PaperCode>.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The element has the <PaperCode>slider</PaperCode> role with <PaperCode>aria-valuenow</PaperCode>, <PaperCode>aria-valuemin</PaperCode>, <PaperCode>aria-valuemax</PaperCode>, and <PaperCode>aria-orientation</PaperCode>.
                The hit area extends <PaperCode>--paper-uigap-half</PaperCode> past each side of the track, so the thin track stays easy to grab.
            </PaperText>
            <PaperText preset="body">
                A press jumps the value to the pointer and captures it, so the drag continues outside the element.
                ArrowRight and ArrowUp add one step. ArrowLeft and ArrowDown remove one.
                PageUp and PageDown move a tenth of the range. Home and End jump to the bounds.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Set <PaperCode>orientation="vertical"</PaperCode> for a column slider. The volume slider in <PaperCode>PaperAudio</PaperCode> uses this form at its default height.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperRange
    aria-label="Volume"
    orientation="vertical"
    min={0}
    max={1}
    step={0.05}
    value={level()}
    valueText={(v) => \`\${Math.round(v * 100)}%\`}
    onInput={setLevel}
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperRange
                    aria-label="Volume"
                    orientation="vertical"
                    min={0}
                    max={1}
                    step={0.05}
                    value={level()}
                    valueText={(v) => `${Math.round(v * 100)}%`}
                    onInput={setLevel}
                />
            </PaperCard>
        </PaperFlex>
    );
}
