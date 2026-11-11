import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCheckbox,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCheckboxDoc() {
    const [releases, setReleases] = createSignal(true);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCheckbox</PaperText>
            <PaperText preset="body" as="p">
                PaperCheckbox is a checkbox with an optional label and description.
                Use it for a yes-or-no option in a form or a list of options, where several can be on at once.
                Use <PaperLink href="/docs/paperui/papertoggle/">PaperToggle</PaperLink> for a setting that applies as soon as it flips.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Bind <PaperCode>checked</PaperCode> and <PaperCode>onChange</PaperCode> to a signal, which makes the checkbox controlled.
                <PaperCode>onChange</PaperCode> receives the new boolean, not an event.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperCheckbox
                    checked={releases()}
                    onChange={setReleases}
                    label="Releases"
                    description="Show release versions."
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperCheckbox } from "@mileniumhq/paperui";

export function Example() {
    const [releases, setReleases] = createSignal(true);

    return (
        <PaperCard padding="double" surface="front">
            <PaperCheckbox
                checked={releases()}
                onChange={setReleases}
                label="Releases"
                description="Show release versions."
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCheckboxProps extends <PaperCode>JSX.InputHTMLAttributes&lt;HTMLInputElement&gt;</PaperCode> without <PaperCode>onChange</PaperCode>.
                Props not listed here, such as <PaperCode>name</PaperCode>, <PaperCode>value</PaperCode>, <PaperCode>id</PaperCode>, and <PaperCode>required</PaperCode>, land on the hidden native input inside.
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
                        <td><PaperCode>checked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>The checked state. When set, you own the state: the box changes only when this prop changes. Leave it unset for an uncontrolled checkbox.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultChecked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Initial state of an uncontrolled checkbox.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(checked: boolean) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the new state after each toggle by click, Space, or Enter.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Text beside the box. Clicking it toggles the checkbox.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Secondary text under the label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the checkbox, removes it from the tab order, and ignores clicks and keys.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the outer <PaperCode>label</PaperCode>, not to the input.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The root is a <PaperCode>label</PaperCode> around a focusable <PaperCode>role="checkbox"</PaperCode> element with <PaperCode>aria-checked</PaperCode>, a visually hidden native input, and the text.</li>
                <li>The box is focusable. Space and Enter both toggle it.</li>
                <li>Each toggle dispatches bubbling <PaperCode>change</PaperCode> and <PaperCode>input</PaperCode> events on the hidden input after setting its <PaperCode>checked</PaperCode>, so a surrounding <PaperCode>form</PaperCode> listener or a <PaperCode>FormData</PaperCode> read sees the value of an input with a <PaperCode>name</PaperCode>.</li>
                <li>The check scales in when the box is checked and out when it is cleared. A box that renders checked does not animate.</li>
                <li>A toggle plays the light haptic on touch devices.</li>
                <li>There is no indeterminate state.</li>
                <li>The box and <PaperCode>aria-checked</PaperCode> follow <PaperCode>checked</PaperCode> when you set it. <PaperCode>onChange</PaperCode> reports the requested state and you decide whether to apply it.</li>
                <li>In a <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>, a named checkbox without <PaperCode>checked</PaperCode> takes its state from the list's record.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="uncontrolled">Uncontrolled</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperCheckbox defaultChecked label="Checked" />
                    <PaperCheckbox label="Unchecked" />
                    <PaperCheckbox disabled label="Disabled" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperCheckbox defaultChecked label="Checked" />
    <PaperCheckbox label="Unchecked" />
    <PaperCheckbox disabled label="Disabled" />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="list-of-options">A list of options</PaperText>
            <PaperText preset="body" as="p">
                Keep the selected keys in one signal and update it from each <PaperCode>onChange</PaperCode>, the way the gameserver panel selects optional plugin dependencies.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import { PaperCheckbox, PaperFlex } from "@mileniumhq/paperui";

const options = ["Worlds", "Plugins", "Logs"];

export function BackupScope() {
    const [selected, setSelected] = createSignal<string[]>(["Worlds"]);

    return (
        <PaperFlex direction="column" gap="full">
            <For each={options}>
                {(option) => (
                    <PaperCheckbox
                        label={option}
                        checked={selected().includes(option)}
                        onChange={(checked) =>
                            setSelected((prev) =>
                                checked ? [...prev, option] : prev.filter((key) => key !== option),
                            )
                        }
                    />
                )}
            </For>
        </PaperFlex>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
