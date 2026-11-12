import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperToggle,
} from "@mileniumhq/paperui";

export default function PaperToggleDoc() {
    const [enabled, setEnabled] = createSignal(true);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperToggle</PaperText>
            <PaperText preset="body" as="p">
                PaperToggle is an on and off switch for a setting that takes effect at once.
                Use it for a feature that is enabled or disabled, such as a notification or a rule.
                For choosing items in a form that you submit, use <PaperLink href="/docs/paperui/papercheckbox/">PaperCheckbox</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                A switch has no visible text of its own, so always give it a name with <PaperCode>aria-label</PaperCode>, or place it in a row whose text names it.
                Keep the state in a signal and write it back in <PaperCode>onChange</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperToggle checked={enabled()} onChange={setEnabled} aria-label="Enabled" />
                    <PaperText preset="text" as="span">{enabled() ? "On" : "Off"}</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperText, PaperToggle } from "@mileniumhq/paperui";

export function Example() {
    const [enabled, setEnabled] = createSignal(true);

    return (
        <PaperFlex direction="row" gap="full" align="center">
            <PaperToggle checked={enabled()} onChange={setEnabled} aria-label="Enabled" />
            <PaperText preset="text" as="span">{enabled() ? "On" : "Off"}</PaperText>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperToggleProps extends <PaperCode>JSX.InputHTMLAttributes&lt;HTMLInputElement&gt;</PaperCode> without <PaperCode>onChange</PaperCode>, which it redefines.
                The element you see is a <PaperCode>div</PaperCode> with <PaperCode>role="switch"</PaperCode>. It holds a hidden checkbox, and props that are not listed below land on that checkbox.
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
                        <td>The state. Setting it makes the switch controlled: it changes only when you change it. Without it the switch is uncontrolled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultChecked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>The starting state of an uncontrolled switch.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(checked: boolean) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the new state when the user flips the switch. It is not called when disabled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the switch, ignores clicks and keys, and removes it from the tab order.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showIcons</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows a check mark on the knob when on and a close mark when off. <PaperCode>false</PaperCode> leaves the knob plain.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The switch's accessible name. It is placed on the switch itself, not on the hidden checkbox, as are <PaperCode>aria-labelledby</PaperCode> and <PaperCode>aria-describedby</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The switch's tooltip, placed on the switch itself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode>, <PaperCode>value</PaperCode>, <PaperCode>id</PaperCode>, <PaperCode>form</PaperCode></td>
                        <td>Input props</td>
                        <td>No default</td>
                        <td>Placed on the hidden checkbox. <PaperCode>name</PaperCode> makes a form include it, and the checkbox's change events carry it to a listener.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the switch.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A click, or Space or Enter while the switch has focus, flips it. Controlled and uncontrolled work as in a form.</li>
                <li>The switch is one tab stop. A disabled switch has <PaperCode>tabindex="-1"</PaperCode> and <PaperCode>aria-disabled="true"</PaperCode>.</li>
                <li><PaperCode>aria-checked</PaperCode> follows the state.</li>
                <li>On a flip, the hidden checkbox is set and fires bubbling <PaperCode>change</PaperCode> and <PaperCode>input</PaperCode> events, so a parent that listens for them, such as a form handler, sees the change. A haptic tap plays where the device supports it.</li>
                <li>A switch inside a <PaperCode>label</PaperCode> changes once when you press the switch, and once when you press the label's text. Both call <PaperCode>onChange</PaperCode>.</li>
                <li>In a <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>, a named switch without <PaperCode>checked</PaperCode> takes its state from the list's record.</li>
                <li>Handlers are yours: PaperToggle does not catch errors thrown by <PaperCode>onChange</PaperCode>. When saving can fail, show the failure to the user and put the state back.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="saved-setting">A setting that saves</PaperText>
            <PaperText preset="body" as="p">
                Keep the switch controlled by the stored value, so a failed save leaves it where it was, and show why.
                The Blocks panel's project cards use a controlled switch for their on and off setting.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperFlex, PaperQuote, PaperToggle } from "@mileniumhq/paperui";

export function EnabledSetting(props: { enabled: boolean; save: (enabled: boolean) => Promise<void> }) {
    const [failure, setFailure] = createSignal<string>();

    async function change(next: boolean) {
        setFailure(undefined);
        try {
            await props.save(next);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <PaperFlex direction="column" gap="half">
            <PaperToggle checked={props.enabled} aria-label="Enabled" onChange={(next) => void change(next)} />
            <Show when={failure()}>
                {(message) => <PaperQuote variant="danger" title="Not saved">{message()}</PaperQuote>}
            </Show>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="plain-knob">Without icons</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperToggle showIcons={false} defaultChecked aria-label="Plain" />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperToggle showIcons={false} defaultChecked aria-label="Plain" />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A setting row with a title, a description, and a control is built with <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>.</li>
                <li>One choice among several is <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink> or <PaperLink href="/docs/paperui/paperselectmenu/">PaperSelectMenu</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
