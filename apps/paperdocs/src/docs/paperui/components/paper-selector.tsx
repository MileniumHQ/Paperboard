import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperSelector,
    PaperSelectorItem,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperSelectorDoc() {
    const [mode, setMode] = createSignal<string | number>("balanced");
    const [features, setFeatures] = createSignal<(string | number)[]>(["alpha"]);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperSelector</PaperText>
            <PaperText preset="body" as="p">
                PaperSelector is a set of large option cards where you pick one, or several.
                Use it when each option needs a title and a line of explanation, such as a mode, a plan, or a model.
                Use <PaperLink href="/docs/paperui/paperselectmenu/">PaperSelectMenu</PaperLink> for a long list in a dropdown, and <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> for navigation between pages.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>name</PaperCode> is required.
                Give each <PaperCode>PaperSelectorItem</PaperCode> a unique <PaperCode>value</PaperCode>, and keep the chosen value in a signal.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSelector name="docs-mode" value={mode()} onValueChange={setMode}>
                    <PaperSelectorItem value="fast" icon="bolt" description="Answers quickly">Fast</PaperSelectorItem>
                    <PaperSelectorItem value="balanced" icon="balance" description="A good mix of both">Balanced</PaperSelectorItem>
                    <PaperSelectorItem value="careful" icon="psychology" description="Takes longer" disabled>Careful</PaperSelectorItem>
                </PaperSelector>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "@mileniumhq/paperui";

export function Example() {
    const [mode, setMode] = createSignal<string | number>("balanced");

    return (
        <PaperSelector name="docs-mode" value={mode()} onValueChange={setMode}>
            <PaperSelectorItem value="fast" icon="bolt" description="Answers quickly">Fast</PaperSelectorItem>
            <PaperSelectorItem value="balanced" icon="balance" description="A good mix of both">Balanced</PaperSelectorItem>
            <PaperSelectorItem value="careful" icon="psychology" description="Takes longer" disabled>Careful</PaperSelectorItem>
        </PaperSelector>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="selector-props">PaperSelector</PaperText>
            <PaperText preset="body" as="p">
                PaperSelectorProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Other props land on the selector's <PaperCode>div</PaperCode>.
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
                        <td>The group name of the items' hidden inputs. Use a distinct name for each selector on a page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default</td>
                        <td>The chosen item's <PaperCode>value</PaperCode>. Setting it makes the selector controlled: it changes only when you change it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td>No default (none chosen)</td>
                        <td>The starting item of an uncontrolled selector.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value: string | number) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the chosen item's <PaperCode>value</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>multiple</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Lets any number of items be chosen. The items become checkboxes, and choosing a chosen item unchooses it. Use <PaperCode>values</PaperCode> and <PaperCode>onValuesChange</PaperCode> instead of the single-value props.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>values</PaperCode></td>
                        <td><PaperCode>readonly (string | number)[]</PaperCode></td>
                        <td>No default</td>
                        <td>With <PaperCode>multiple</PaperCode>, the chosen values. Setting it makes the selector controlled.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValues</PaperCode></td>
                        <td><PaperCode>readonly (string | number)[]</PaperCode></td>
                        <td>No default (none chosen)</td>
                        <td>With <PaperCode>multiple</PaperCode>, the starting values of an uncontrolled selector.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValuesChange</PaperCode></td>
                        <td><PaperCode>(values: (string | number)[]) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>With <PaperCode>multiple</PaperCode>, called with the new list, in the order chosen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode> lays the items in a wrapping row, sharing the width. Vertical stacks them at full width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>horizontal</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Shorthand for <PaperCode>direction="horizontal"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the selector.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="item-props">PaperSelectorItem</PaperText>
            <PaperText preset="body" as="p">
                PaperSelectorItemProps extends <PaperCode>JSX.InputHTMLAttributes&lt;HTMLInputElement&gt;</PaperCode>. The title is the children.
                Props not listed here go to the hidden input, and with <PaperCode>href</PaperCode> they are not applied.
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
                        <td>The item's identity. Keep it unique within the selector.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The item's title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A smaller line under the title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A leading icon. A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Dims the item and ignores choosing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>colorless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>True while not chosen</td>
                        <td>Controls the paper press effect's color. An unchosen item presses without color and a chosen one with the primary color. Set it to override.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reverse</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Puts the icon at the end and aligns the text to the right.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Renders the item as a link instead of a radio choice. See Links.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the item's outer element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="selection">Choosing</PaperText>
            <PaperTextList>
                <li>Each item is a label around a visually hidden radio input, or a checkbox with <PaperCode>multiple</PaperCode>. A click on the card, or the input's own keyboard behavior, chooses it.</li>
                <li>The chosen item has a deep primary border and outline.</li>
                <li>In single mode the browser moves between items of one <PaperCode>name</PaperCode> with the arrow keys, and Space chooses. In <PaperCode>multiple</PaperCode> mode each item is a checkbox with its own tab stop, and Space toggles.</li>
                <li>Controlled and uncontrolled work as in a form: with <PaperCode>value</PaperCode> or <PaperCode>values</PaperCode> set, the choice changes only when your signal does. Ignore the callback to refuse a change.</li>
                <li>The items press with the paper effect. A disabled item does not.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="links">Links</PaperText>
            <PaperTextList>
                <li>With <PaperCode>href</PaperCode> an item is an <PaperCode>a</PaperCode> drawn like the others. There is no input, and following it never calls <PaperCode>onValueChange</PaperCode>.</li>
                <li>The selector's <PaperCode>value</PaperCode> still draws the matching item as chosen, and gives that link <PaperCode>aria-current="page"</PaperCode>.</li>
                <li>A disabled link loses its <PaperCode>href</PaperCode> and gets <PaperCode>aria-disabled="true"</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="multiple">Several at once</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSelector name="docs-features" multiple values={features()} onValuesChange={setFeatures}>
                    <PaperSelectorItem value="alpha" icon="looks_one">Alpha</PaperSelectorItem>
                    <PaperSelectorItem value="beta" icon="looks_two">Beta</PaperSelectorItem>
                    <PaperSelectorItem value="gamma" icon="looks_3">Gamma</PaperSelectorItem>
                </PaperSelector>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "@mileniumhq/paperui";

export function Features() {
    const [features, setFeatures] = createSignal<(string | number)[]>(["alpha"]);

    return (
        <PaperSelector name="docs-features" multiple values={features()} onValuesChange={setFeatures}>
            <PaperSelectorItem value="alpha" icon="looks_one">Alpha</PaperSelectorItem>
            <PaperSelectorItem value="beta" icon="looks_two">Beta</PaperSelectorItem>
            <PaperSelectorItem value="gamma" icon="looks_3">Gamma</PaperSelectorItem>
        </PaperSelector>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="refuse">Refusing a change while busy</PaperText>
            <PaperText preset="body" as="p">
                A controlled selector only moves when you move it.
                The Agent panel's project picker ignores a choice while a save is running.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperSelector, PaperSelectorItem } from "@mileniumhq/paperui";

export function ProjectPicker(props: {
    current: string;
    saving: boolean;
    choose: (id: string) => void;
}) {
    return (
        <PaperSelector
            name="project"
            value={props.current}
            onValueChange={(value) => {
                if (!props.saving) props.choose(String(value));
            }}
        >
            <PaperSelectorItem value="one" icon="folder">Project one</PaperSelectorItem>
            <PaperSelectorItem value="two" icon="folder">Project two</PaperSelectorItem>
        </PaperSelector>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="row">A row of options</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperCode>horizontal</PaperCode> for a few short options that fit side by side.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperSelector name="docs-row" horizontal defaultValue="a">
                    <PaperSelectorItem value="a" icon="light_mode">Light</PaperSelectorItem>
                    <PaperSelectorItem value="b" icon="dark_mode">Dark</PaperSelectorItem>
                </PaperSelector>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperSelector name="docs-row" horizontal defaultValue="a">
    <PaperSelectorItem value="a" icon="light_mode">Light</PaperSelectorItem>
    <PaperSelectorItem value="b" icon="dark_mode">Dark</PaperSelectorItem>
</PaperSelector>`}
            </PaperCode>
        </PaperFlex>
    );
}
