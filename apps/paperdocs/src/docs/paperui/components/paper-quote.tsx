import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperQuoteDoc() {
    const [dismissed, setDismissed] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperQuote</PaperText>
            <PaperText preset="body" as="p">
                PaperQuote is a callout box with an optional icon and title, for a message that sits in the page: a failure, a warning, a tip, or a note.
                Use it to show errors where they happened, in any role color, and give it <PaperCode>onDismiss</PaperCode> when the message should outlive the moment.
                When a region has no content yet, use <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The children are the message.
                Without a <PaperCode>variant</PaperCode> the quote is monochrome.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperQuote icon="info" title="Title">A message that belongs to the page.</PaperQuote>
                    <PaperQuote variant="danger" icon="warning" title="Danger">Something failed.</PaperQuote>
                    <PaperQuote variant="success" icon="check_circle">Saved.</PaperQuote>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperQuote } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="full">
            <PaperQuote icon="info" title="Title">A message that belongs to the page.</PaperQuote>
            <PaperQuote variant="danger" icon="warning" title="Danger">Something failed.</PaperQuote>
            <PaperQuote variant="success" icon="check_circle">Saved.</PaperQuote>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperQuoteProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the quote's <PaperCode>div</PaperCode>, so <PaperCode>role</PaperCode> and <PaperCode>aria-*</PaperCode> work there.
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The message. Long words and paths wrap instead of overflowing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperQuoteVariant</PaperCode></td>
                        <td><PaperCode>"monochrome"</PaperCode></td>
                        <td><PaperCode>"monochrome"</PaperCode> or a role: <PaperCode>"primary"</PaperCode>, <PaperCode>"brand"</PaperCode>, <PaperCode>"success"</PaperCode>, <PaperCode>"danger"</PaperCode>, <PaperCode>"warning"</PaperCode>, <PaperCode>"attention"</PaperCode>, <PaperCode>"extra-1"</PaperCode>, <PaperCode>"extra-2"</PaperCode>, or <PaperCode>"extra-3"</PaperCode>. A role tints the quote in its color.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>A leading icon. A string is a Material icon name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A bold line above the message. It is not a heading element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onDismiss</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default (no close button)</td>
                        <td>Adds a close button at the end of the quote and calls this when it is pressed. The quote does not remove itself: clear the state that shows it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the quote.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="ts">
{`type PaperQuoteVariant = "monochrome" | PaperRole;
// PaperRole: "primary" | "brand" | "success" | "danger" | "warning" | "attention" | "extra-1" | "extra-2" | "extra-3"`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The quote has no ARIA role of its own. For a failure that appears after the user acts, add <PaperCode>role="alert"</PaperCode> so assistive technology announces it.</li>
                <li>The close button is named "Dismiss".</li>
                <li>The quote is a block that takes the width of its container, with a colored bar on its leading edge. A role variant also tints the background.</li>
                <li>The message sits in a text wrapper, so an element child works too: a <PaperCode>PaperFlex</PaperCode> holding the message and a retry button is a common failure layout.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="failure">Show a failure where it happened</PaperText>
            <PaperText preset="body" as="p">
                A failed action shows its reason in the page, never silently.
                When a failure covers a whole view, such as a load that failed, put a quote at the top with <PaperCode>onDismiss</PaperCode> and an action to retry.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";

export function Save(props: { save: () => Promise<void> }) {
    const [failure, setFailure] = createSignal<string>();

    async function save() {
        setFailure(undefined);
        try {
            await props.save();
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <PaperFlex direction="column" gap="full">
            <Show when={failure()}>
                {(message) => (
                    <PaperQuote
                        variant="danger"
                        icon="warning"
                        title="Not saved"
                        role="alert"
                        onDismiss={() => setFailure(undefined)}
                    >
                        {message()}
                    </PaperQuote>
                )}
            </Show>
            <PaperButton variant="primary" onClick={() => void save()}>Save</PaperButton>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="dismissable">A dismissible notice</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full" align="flex-start">
                    <Show when={!dismissed()}>
                        <PaperQuote variant="warning" icon="backup" title="Back up first" onDismiss={() => setDismissed(true)}>
                            Worlds may not survive an update.
                        </PaperQuote>
                    </Show>
                    <Show when={dismissed()}>
                        <PaperButton onClick={() => setDismissed(false)}>Show again</PaperButton>
                    </Show>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";

export function Notice() {
    const [dismissed, setDismissed] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="full" align="flex-start">
            <Show when={!dismissed()}>
                <PaperQuote variant="warning" icon="backup" title="Back up first" onDismiss={() => setDismissed(true)}>
                    Worlds may not survive an update.
                </PaperQuote>
            </Show>
            <Show when={dismissed()}>
                <PaperButton onClick={() => setDismissed(false)}>Show again</PaperButton>
            </Show>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A quote reports something. <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> fills a whole region that has no content, with an optional action to get some.</li>
                <li>A failure the user must answer before going on belongs in a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.</li>
                <li>Markdown block quotes render as a monochrome PaperQuote through <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
