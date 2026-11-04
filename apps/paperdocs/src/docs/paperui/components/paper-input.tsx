import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperInputDoc() {
    const [name, setName] = createSignal("");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperInput</PaperText>
            <PaperText preset="body" as="p">
                PaperInput is a text field with an optional label in its border, a leading icon, and validation styling.
                Use it for every single-line field in a panel, and set <PaperCode>multiline</PaperCode> for a text area.
                Every native input attribute passes through.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>label</PaperCode> to name the field.
                The label sits in a notch of the top border and is the input's accessible name.
                Read the value from <PaperCode>onInput</PaperCode> with <PaperCode>e.currentTarget.value</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperInput
                    label="Name"
                    placeholder="Text"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperInput } from "@mileniumhq/paperui";

export function Example() {
    const [name, setName] = createSignal("");

    return (
        <PaperCard padding="double" surface="front">
            <PaperInput
                label="Name"
                placeholder="Text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperInputProps extends <PaperCode>JSX.InputHTMLAttributes&lt;HTMLInputElement&gt;</PaperCode> without <PaperCode>ref</PaperCode>.
                Props not listed here, such as <PaperCode>placeholder</PaperCode>, <PaperCode>name</PaperCode>, <PaperCode>autocomplete</PaperCode>, <PaperCode>required</PaperCode>, <PaperCode>maxlength</PaperCode>, and <PaperCode>onKeyDown</PaperCode>, land on the <PaperCode>input</PaperCode> or <PaperCode>textarea</PaperCode> itself.
                <PaperCode>class</PaperCode> and <PaperCode>classList</PaperCode> land on the wrapper.
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
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The field's name, drawn in a notch of the top border. It is linked to the input with <PaperCode>for</PaperCode>; an <PaperCode>id</PaperCode> is generated when you set none.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (uncontrolled)</td>
                        <td>The text, converted to a string. When set, the field follows it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>""</PaperCode></td>
                        <td>Initial text of an uncontrolled field.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"text"</PaperCode></td>
                        <td>The input type, such as <PaperCode>"password"</PaperCode>, <PaperCode>"number"</PaperCode>, or <PaperCode>"url"</PaperCode>. Ignored when multiline.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A leading icon: a string is a Material icon name. It is decoration and does not take clicks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>A shorter field with smaller corners, for toolbars and command rows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Fills the container. Without it a single-line field is as wide as its content. A multiline field always fills the container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>invalid</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>Forces the error styling and <PaperCode>aria-invalid</PaperCode> on or off. When set, <PaperCode>validate</PaperCode> is not consulted.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>validate</PaperCode></td>
                        <td><PaperCode>(value: string) =&gt; boolean</PaperCode></td>
                        <td>No default</td>
                        <td>Return <PaperCode>true</PaperCode> for a valid value. A <PaperCode>false</PaperCode> result draws the error styling and sets <PaperCode>aria-invalid</PaperCode>. It runs on every change, including the initial value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables the field and dims it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onInput</PaperCode>, <PaperCode>onChange</PaperCode></td>
                        <td>Native event handlers</td>
                        <td>No default</td>
                        <td>Receive the native event. <PaperCode>onInput</PaperCode> fires per keystroke, <PaperCode>onChange</PaperCode> on commit (blur or Enter).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td>Solid ref</td>
                        <td>No default</td>
                        <td>An element variable or a callback that receives the input, or the textarea when multiline.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>multiline</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (single line)</td>
                        <td>Renders a textarea. Every other prop behaves the same, except the input-only ones: <PaperCode>type</PaperCode>, <PaperCode>min</PaperCode>, <PaperCode>max</PaperCode>, <PaperCode>step</PaperCode>, <PaperCode>pattern</PaperCode>, and <PaperCode>size</PaperCode> have no effect.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rows</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>4</PaperCode></td>
                        <td>Visible rows when multiline. Ignored otherwise.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resize</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default</td>
                        <td>A multiline field resizes vertically unless this is <PaperCode>false</PaperCode>, which removes the handle.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Set on the input. With a <PaperCode>label</PaperCode> and no <PaperCode>id</PaperCode>, one is generated.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The wrapper <PaperCode>div</PaperCode> carries <PaperCode>data-invalid</PaperCode> and <PaperCode>data-disabled</PaperCode> ("true" or "false") for styling and tests.</li>
                <li>A field with no <PaperCode>label</PaperCode> has no accessible name of its own. Give it an <PaperCode>aria-label</PaperCode> or an <PaperCode>id</PaperCode> that a <PaperCode>label</PaperCode> element points at.</li>
                <li>Validation is visual. A field that fails <PaperCode>validate</PaperCode> still submits and still fires its events, so check the value again before you act on it, and tell the user what is wrong.</li>
                <li>The browser's own constraints, such as <PaperCode>required</PaperCode> and <PaperCode>pattern</PaperCode>, also draw the error styling when they fail.</li>
                <li>In a <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>, a named field without <PaperCode>value</PaperCode> takes its value from the list's record.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="icon-and-compact">Icon, compact, and full width</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperInput icon="search" placeholder="Search" fullWidth />
                    <PaperInput compact icon="chevron_right" placeholder="Command" fullWidth />
                    <PaperInput label="Disabled" disabled defaultValue="Text" fullWidth />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperInput icon="search" placeholder="Search" fullWidth />
    <PaperInput compact icon="chevron_right" placeholder="Command" fullWidth />
    <PaperInput label="Disabled" disabled defaultValue="Text" fullWidth />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="validation">Validation</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperCode>invalid</PaperCode> when you already hold the verdict, and <PaperCode>validate</PaperCode> for a rule on the text itself.
                Show the reason in text next to the field.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperInput label="Port" defaultValue="80000" validate={(value) => Number(value) <= 65535} fullWidth />
                    <PaperInput label="Name" defaultValue="Text" invalid fullWidth />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="full">
    <PaperInput label="Port" defaultValue="80000" validate={(value) => Number(value) <= 65535} fullWidth />
    <PaperInput label="Name" defaultValue="Text" invalid fullWidth />
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="multiline">Multiline</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperInput label="Notes" multiline rows={3} placeholder="Text" />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperInput label="Notes" multiline rows={3} placeholder="Text" />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="secrets">Secrets</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperCode>type="password"</PaperCode> for a token or password, and store the submitted value with <PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink>, never in the panel's config.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperInput } from "@mileniumhq/paperui";

export function TokenField(props: { save: (token: string) => void }) {
    return (
        <PaperInput
            label="Token"
            type="password"
            autocomplete="off"
            fullWidth
            onChange={(e) => props.save(e.currentTarget.value)}
        />
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
