import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSelectMenuDoc() {
    const [size, setSize] = createSignal<string | number>("medium");
    const [provider, setProvider] = createSignal<string | number>("");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSelectMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperSelectMenu is a dropdown for choosing one value from a list, with optional icons, descriptions, and a search field.
                Use it when there are too many options to show as cards, or a field in a form needs a compact control.
                Use <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink> for a few options with explanations, and <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> for a menu of actions.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Children are <PaperCode>PaperSelectMenuItem</PaperCode> options, each with a unique <PaperCode>value</PaperCode>.
                Keep the chosen value in a signal.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSelectMenu name="docs-size" value={size()} onValueChange={setSize}>
                    <PaperSelectMenuItem value="small">Small</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="medium">Medium</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="large">Large</PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperSelectMenu, PaperSelectMenuItem } from "@mileniumhq/paperui";

export function Example() {
    const [size, setSize] = createSignal<string | number>("medium");

    return (
        <PaperSelectMenu name="docs-size" value={size()} onValueChange={setSize}>
            <PaperSelectMenuItem value="small">Small</PaperSelectMenuItem>
            <PaperSelectMenuItem value="medium">Medium</PaperSelectMenuItem>
            <PaperSelectMenuItem value="large">Large</PaperSelectMenuItem>
        </PaperSelectMenu>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="menu-props">PaperSelectMenu</PaperText>
            <PaperText preset="body" as="p">
                PaperSelectMenuProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>onChange</PaperCode> and <PaperCode>onInput</PaperCode>.
                Other props land on the wrapping <PaperCode>div</PaperCode>, around the trigger button.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>Adds a hidden text input of this name that always holds the current value, so a form reads it. On every choice the input fires bubbling <PaperCode>input</PaperCode> and <PaperCode>change</PaperCode> events, which a parent form or handler can listen to.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default</td>
                        <td>The chosen option's <PaperCode>value</PaperCode>. Setting it makes the menu controlled: it changes only when you change it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (nothing chosen)</td>
                        <td>The starting option of an uncontrolled menu.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the option's <PaperCode>value</PaperCode> when the user picks one, including the one already chosen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placeholder</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>"Select" and an ellipsis</td>
                        <td>The trigger's text while nothing is chosen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>searchable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Adds a search field above the options. See Searching.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>searchPlaceholder</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Search"</PaperCode></td>
                        <td>The search field's placeholder, which is also its accessible name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Stretches the trigger across its container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the trigger and ignores clicks and keys.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the wrapper.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperSelectMenuItem</PaperText>
            <PaperText preset="body" as="p">
                PaperSelectMenuItemProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>. The option's label is the children.
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
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The option's identity. Keep it unique within the menu. It is also searched.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The label, shown in the list and on the trigger when chosen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A leading icon. A string is a Material icon name. The trigger shows the chosen option's icon too.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A second line under the label. A text description is searched.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>keywords</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>More words the search finds the option by. They are not displayed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the option and ignores choosing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the option.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="opening">Opening and choosing</PaperText>
            <PaperTextList>
                <li>The trigger is a button with <PaperCode>aria-haspopup="listbox"</PaperCode> and <PaperCode>aria-expanded</PaperCode>. It shows the chosen option's icon and label, the placeholder, or, for a value with no matching option, the value as text.</li>
                <li>The list opens below the trigger, at least as wide as the trigger, in a portal so no clipping parent cuts it off. It has <PaperCode>role="listbox"</PaperCode>, and each option <PaperCode>role="option"</PaperCode> with <PaperCode>aria-selected</PaperCode>.</li>
                <li>Options stay in the page while the list is closed, so the trigger can show the chosen option's label before the first open. An option added later, or one whose <PaperCode>value</PaperCode> changes, labels the trigger under its current value.</li>
                <li>In a <PaperLink href="/docs/paperui/papersettinglist/">PaperSettingList</PaperLink>, a named menu without <PaperCode>value</PaperCode> takes its value from the list's record.</li>
                <li>Choosing an option calls <PaperCode>onValueChange</PaperCode> and closes the list. With <PaperCode>value</PaperCode> set, nothing changes until your signal does.</li>
                <li>The chosen option is highlighted when the list opens.</li>
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
                        <td>Enter, Space, Up, Down on the trigger</td>
                        <td>Open the list.</td>
                    </tr>
                    <tr>
                        <td>Up and Down while open</td>
                        <td>Move the highlight, wrapping at the ends, as in <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td>Enter while open</td>
                        <td>Choose the highlighted option.</td>
                    </tr>
                    <tr>
                        <td>Escape while open</td>
                        <td>Close the list without choosing.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A press outside the list closes it.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="searching">Searching</PaperText>
            <PaperTextList>
                <li>With <PaperCode>searchable</PaperCode> a search field sits at the top of the list and takes focus when it opens.</li>
                <li>Every word typed must appear in the option's label (when it is text), description, value, or keywords. Matching ignores case.</li>
                <li>Typing highlights the first option left, so Enter picks it. Space types a space instead of choosing.</li>
                <li>With no match the list shows "No matches". Closing the list clears the search.</li>
                <li>An option the search hides is still registered, so a chosen one keeps its label on the trigger.</li>
                <li>A label that is an element, not text, is searched only through <PaperCode>value</PaperCode>, <PaperCode>description</PaperCode>, and <PaperCode>keywords</PaperCode>. Add <PaperCode>keywords</PaperCode> for it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="searchable">Searchable list with descriptions</PaperText>
            <PaperText preset="body" as="p">
                The Agents panel's provider picker is a searchable menu.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSelectMenu
                    name="docs-provider"
                    searchable
                    placeholder="Provider"
                    value={provider()}
                    onValueChange={setProvider}
                >
                    <PaperSelectMenuItem value="alpha" icon="cloud" description="Hosted" keywords="remote">Alpha</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="beta" icon="computer" description="Runs on this computer" keywords="local">Beta</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="gamma" icon="lock" disabled>Gamma</PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperSelectMenu, PaperSelectMenuItem } from "@mileniumhq/paperui";

export function Provider() {
    const [provider, setProvider] = createSignal<string | number>("");

    return (
        <PaperSelectMenu
            name="docs-provider"
            searchable
            placeholder="Provider"
            value={provider()}
            onValueChange={setProvider}
        >
            <PaperSelectMenuItem value="alpha" icon="cloud" description="Hosted" keywords="remote">Alpha</PaperSelectMenuItem>
            <PaperSelectMenuItem value="beta" icon="computer" description="Runs on this computer" keywords="local">Beta</PaperSelectMenuItem>
            <PaperSelectMenuItem value="gamma" icon="lock" disabled>Gamma</PaperSelectMenuItem>
        </PaperSelectMenu>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="in-a-form">Inside a form</PaperText>
            <PaperText preset="body" as="p">
                With <PaperCode>name</PaperCode> the hidden input takes part in the form.
                Read it from the form's data on submit.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperFlex, PaperSelectMenu, PaperSelectMenuItem } from "@mileniumhq/paperui";

export function Form(props: { onSave: (theme: string) => void }) {
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                props.onSave(String(data.get("theme")));
            }}
        >
            <PaperFlex direction="column" gap="full" align="flex-start">
                <PaperSelectMenu name="theme" defaultValue="system">
                    <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
                </PaperSelectMenu>
                <PaperButton type="submit" variant="primary">Save</PaperButton>
            </PaperFlex>
        </form>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
