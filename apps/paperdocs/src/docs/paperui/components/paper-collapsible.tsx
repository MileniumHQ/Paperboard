import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperCollapsible,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCollapsibleDoc() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCollapsible</PaperText>
            <PaperText preset="body" as="p">
                PaperCollapsible is a button that shows and hides what is under it.
                Use it for details the page needn't show at once: the exact commands behind a request, advanced options, or a long explanation under a short one.
                For a list of sections that each fold, use <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> sections instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The <PaperCode>title</PaperCode> is the button. The children are what it shows.
                It starts closed and keeps its own state.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperCollapsible title="Show details">
                    <PaperText preset="body">The folder and the two commands the agent asked for.</PaperText>
                </PaperCollapsible>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCollapsible, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCollapsible title="Show details">
            <PaperText preset="body">The folder and the two commands the agent asked for.</PaperText>
        </PaperCollapsible>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCollapsibleProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the outer <PaperCode>div</PaperCode>.
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
                        <td>No default (required)</td>
                        <td>What the button says.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>What opening it shows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>An icon between the chevron and the title. A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (it keeps its own state)</td>
                        <td>Whether it is open, when the page decides. Pair it with <PaperCode>onOpenChange</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultOpen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Whether it starts open, when it keeps its own state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onOpenChange</PaperCode></td>
                        <td><PaperCode>(open: boolean) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the new state when the button is pressed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the outer element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The button is a real button with <PaperCode>aria-expanded</PaperCode>, so Enter and Space toggle it and assistive technology says whether it is open.</li>
                <li>The content is a region named by the button. It stays in the page while closed but is inert: nothing in it takes focus or is read out.</li>
                <li>Opening grows the content to its own height and turns the chevron. With reduced motion it opens at once.</li>
                <li>The button is as wide as its title, so it sits in a line of text or a card without stretching.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="controlled">Open it from elsewhere</PaperText>
            <PaperText preset="body" as="p">
                Give it <PaperCode>open</PaperCode> and <PaperCode>onOpenChange</PaperCode> when something else on the page opens or closes it too.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full" align="flex-start">
                    <PaperButton onClick={() => setOpen(!open())}>{open() ? "Hide the commands" : "Show the commands"}</PaperButton>
                    <PaperCollapsible title="Commands" icon="terminal" open={open()} onOpenChange={setOpen}>
                        <PaperCode block language="sh">{"npm install\nnpm run build"}</PaperCode>
                    </PaperCollapsible>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperCode, PaperCollapsible, PaperFlex } from "@mileniumhq/paperui";

export function Commands() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="full" align="flex-start">
            <PaperButton onClick={() => setOpen(!open())}>{open() ? "Hide the commands" : "Show the commands"}</PaperButton>
            <PaperCollapsible title="Commands" icon="terminal" open={open()} onOpenChange={setOpen}>
                <PaperCode block language="sh">{"npm install\\nnpm run build"}</PaperCode>
            </PaperCollapsible>
        </PaperFlex>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
