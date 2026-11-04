import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperToggle,
} from "@mileniumhq/paperui";

export default function PaperSettingListDoc() {
    const [enabled, setEnabled] = createSignal(true);
    const [name, setName] = createSignal("Name");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSettingList</PaperText>
            <PaperText preset="body" as="p">
                PaperSettingList is a bordered card of setting rows, each with a title and description on the left and its control on the right.
                Use it for toggles, fields and choices that belong together, such as a panel's settings page.
                It is its own surface, so you do not wrap it in a card.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put one PaperSettingItem per setting inside the list.
                The control is the item's child and handles its own change, as the first-party panels do.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Enabled" description="Description of the setting.">
                        <PaperToggle checked={enabled()} onChange={setEnabled} />
                    </PaperSettingItem>
                    <PaperSettingItem title="Name" description="Another description.">
                        <PaperInput label="Name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                    </PaperSettingItem>
                    <PaperSettingItem title="Disabled" description="Dimmed, and ignores the pointer." disabled>
                        <PaperToggle checked />
                    </PaperSettingItem>
                </PaperSettingList>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperInput, PaperSettingItem, PaperSettingList, PaperToggle } from "@mileniumhq/paperui";

export function Settings() {
    const [enabled, setEnabled] = createSignal(true);
    const [name, setName] = createSignal("Name");

    return (
        <PaperSettingList autoHeight>
            <PaperSettingItem title="Enabled" description="Description of the setting.">
                <PaperToggle checked={enabled()} onChange={setEnabled} />
            </PaperSettingItem>
            <PaperSettingItem title="Name" description="Another description.">
                <PaperInput label="Name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </PaperSettingItem>
            <PaperSettingItem title="Disabled" description="Dimmed, and ignores the pointer." disabled>
                <PaperToggle checked />
            </PaperSettingItem>
        </PaperSettingList>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="list-props">PaperSettingList</PaperText>
            <PaperText preset="body" as="p">
                PaperSettingListProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
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
                        <td><PaperCode>autoHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Sizes the list to its rows and clips instead of scrolling. Without it the list scrolls vertically when its parent limits its height.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flat</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Drops the border and the rounded corners, for a list that fills a pane edge to edge.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flex</PaperCode></td>
                        <td><PaperCode>boolean | number | CSS flex</PaperCode></td>
                        <td>No default</td>
                        <td>Flex behavior in a flex parent. <PaperCode>true</PaperCode> is <PaperCode>1 1 0%</PaperCode>, <PaperCode>false</PaperCode> is <PaperCode>none</PaperCode>, a number <PaperCode>n</PaperCode> is <PaperCode>n n 0%</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                        <td>No default</td>
                        <td>Replaces the record that <PaperCode>onValueChange</PaperCode> reports. See Named controls.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                        <td><PaperCode>{`{}`}</PaperCode></td>
                        <td>The record at the start, when <PaperCode>value</PaperCode> is not set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(values: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the whole record after a named control changes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element. An object <PaperCode>style</PaperCode> is merged after <PaperCode>flex</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperSettingItem</PaperText>
            <PaperText preset="body" as="p">
                PaperSettingItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Children are the control, right-aligned.
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
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>Required</td>
                        <td>The setting's name, in the <PaperCode>label</PaperCode> text preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (none)</td>
                        <td>A line under the title, in the <PaperCode>hint</PaperCode> preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the row to half opacity and blocks the pointer on it. See Behavior.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the row.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="layout">Layout</PaperText>
            <PaperTextList>
                <li>The list is 100% wide, with a raised surface, a border and rounded, clipped corners. Rows sit on the same surface, divided by a subtle rule, with none under the last row.</li>
                <li>A row puts the title block on the left, taking the free width, and the control on the right.</li>
                <li>A row that contains a <PaperCode>textarea</PaperCode> (a <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink> with <PaperCode>multiline</PaperCode>) stacks the control under the title at full width.</li>
                <li>The list does not set a height. A row list in a bounded parent scrolls, and <PaperCode>autoHeight</PaperCode> turns that off.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="named-controls">Named controls</PaperText>
            <PaperText preset="body" as="p">
                The list listens to <PaperCode>input</PaperCode> and <PaperCode>change</PaperCode> events from the controls inside it.
                A native <PaperCode>input</PaperCode>, <PaperCode>select</PaperCode> or <PaperCode>textarea</PaperCode> with a <PaperCode>name</PaperCode> (PaperInput and PaperToggle pass <PaperCode>name</PaperCode> to theirs) adds its value to a record, and the list calls <PaperCode>onValueChange</PaperCode> with the whole record.
            </PaperText>
            <PaperTextList>
                <li>A checkbox contributes its <PaperCode>checked</PaperCode> boolean. Every other control contributes its <PaperCode>value</PaperCode> string, so a number input gives <PaperCode>"8"</PaperCode>, not <PaperCode>8</PaperCode>.</li>
                <li>A control with no <PaperCode>name</PaperCode> is ignored.</li>
                <li>A text field fires <PaperCode>input</PaperCode> while typing and <PaperCode>change</PaperCode> on blur, and a <PaperLink href="/docs/paperui/papertoggle/">PaperToggle</PaperLink> fires both at once, so <PaperCode>onValueChange</PaperCode> can run twice for one edit.</li>
                <li>The record never writes back into the controls. <PaperCode>value</PaperCode> and <PaperCode>defaultValue</PaperCode> only set what the record contains, so set each control's own value or checked state yourself.</li>
                <li>First-party panels handle each control's change directly, as in Usage. Use <PaperCode>onValueChange</PaperCode> when one handler should see every setting.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="disabled">Disabled rows</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>disabled</PaperCode> on a row blocks pointer events on it.
                Keyboard focus can still reach a control inside, so disable the control as well when it must not be operated.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="named-example">One handler for a group of fields</PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperInput, PaperSettingItem, PaperSettingList, PaperToggle } from "@mileniumhq/paperui";

export function Network() {
    const [values, setValues] = createSignal<Record<string, unknown>>({ host: "localhost", secure: false });

    return (
        <PaperSettingList defaultValue={values()} onValueChange={setValues} autoHeight>
            <PaperSettingItem title="Host" description="The address to connect to.">
                <PaperInput name="host" label="Host" value={String(values().host)} />
            </PaperSettingItem>
            <PaperSettingItem title="Secure" description="Use an encrypted connection.">
                <PaperToggle name="secure" checked={Boolean(values().secure)} />
            </PaperSettingItem>
        </PaperSettingList>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A free-form card of content is <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>.</li>
                <li>A list of items to open, drag or select is <PaperLink href="/docs/paperui/paperlist/">PaperList</PaperLink>.</li>
                <li>A read-only list of facts is <PaperLink href="/docs/paperui/paperkeyvaluelist/">PaperKeyValueList</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
