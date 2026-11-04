import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperTextDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperText</PaperText>
            <PaperText preset="body" as="p">
                PaperText is the one way to draw text in a panel: a preset picks the size, weight, and color for a role such as a title, a hint, or an error.
                Use it for every heading, label, and line of copy, and pick the real element with <PaperCode>as</PaperCode>.
                For Markdown from another source use <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>, and for bulleted text, <PaperLink href="/docs/paperui/papertextlist/">PaperTextList</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Without <PaperCode>as</PaperCode> the text is a <PaperCode>span</PaperCode>.
                Set <PaperCode>as</PaperCode> to the element the content is, so the page has a heading outline and real paragraphs.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="title" as="h2">Title</PaperText>
                    <PaperText preset="body" as="p">A paragraph of body text.</PaperText>
                    <PaperText preset="hint" as="p">A hint that supports it.</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperFlex direction="column" gap="half">
            <PaperText preset="title" as="h2">Title</PaperText>
            <PaperText preset="body" as="p">A paragraph of body text.</PaperText>
            <PaperText preset="hint" as="p">A hint that supports it.</PaperText>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperTextProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLElement&gt;</PaperCode>.
                Other props land on the element, so <PaperCode>id</PaperCode>, <PaperCode>title</PaperCode>, <PaperCode>role</PaperCode>, and <PaperCode>aria-*</PaperCode> work.
                An object <PaperCode>style</PaperCode> is merged after the component's own, and the element gets <PaperCode>data-preset</PaperCode> when a preset is set.
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
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>PaperTextPreset</PaperCode></td>
                        <td>No default</td>
                        <td>A role for the text: size, weight, and styling. See Presets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>as</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"span"</PaperCode></td>
                        <td>The HTML element to render, such as <PaperCode>"h2"</PaperCode>, <PaperCode>"p"</PaperCode>, <PaperCode>"label"</PaperCode>, or <PaperCode>"li"</PaperCode>. A preset never changes the element, so a heading needs <PaperCode>as</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The preset's size, or 4 with no preset</td>
                        <td>A step of the text scale, 0 to 17: 1 is 12 pixels, 2 is 14, 3 is 16, 4 is 18, and 10 is 34. It overrides the preset's size.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>weight</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The preset's weight, or 400 with no preset</td>
                        <td>A CSS font weight such as 400, 500, 600, or 700. It overrides the preset's weight.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>color</PaperCode></td>
                        <td><PaperCode>PaperColor</PaperCode></td>
                        <td>No default (the preset's, or inherited)</td>
                        <td>A token such as <PaperCode>"text-subtle"</PaperCode> or <PaperCode>"danger"</PaperCode>, or a CSS value written as a hex, a color function, <PaperCode>currentColor</PaperCode>, or <PaperCode>transparent</PaperCode>. The text colors are <PaperCode>text</PaperCode>, <PaperCode>text-muted</PaperCode>, <PaperCode>text-subtle</PaperCode>, <PaperCode>text-faint</PaperCode>, <PaperCode>contrast</PaperCode>, and <PaperCode>on-color</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>family</PaperCode></td>
                        <td><PaperCode>"body" | "code"</PaperCode></td>
                        <td><PaperCode>"body"</PaperCode></td>
                        <td><PaperCode>"code"</PaperCode> switches to the monospace font.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rounded</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Uses the rounded font family.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>breakWord</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Breaks a long unbroken word, such as a path or a hash, instead of overflowing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>truncate</PaperCode></td>
                        <td><PaperCode>boolean | number</PaperCode></td>
                        <td>No default (off)</td>
                        <td><PaperCode>true</PaperCode> or <PaperCode>1</PaperCode> keeps one line and ends it with an ellipsis. A number above 1 allows that many lines. Use it on a block element, such as <PaperCode>as="p"</PaperCode>, that has a limited width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>inset</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Makes the text a block indented by the inset of a card's content, so text outside a card lines up with text inside one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode>, <PaperCode>style</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element. Prefer props to a class.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="presets">Presets</PaperText>
            <PaperText preset="body" as="p">
                Every preset sets a size and a weight, and some add more.
                An explicit <PaperCode>size</PaperCode>, <PaperCode>weight</PaperCode>, or <PaperCode>color</PaperCode> wins over the preset.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Preset</th>
                        <th>Size and weight</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>headline</PaperCode></td>
                        <td>12 (42 px), 800</td>
                        <td>A hero line on a landing or welcome screen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>header</PaperCode></td>
                        <td>10 (34 px), 700</td>
                        <td>The name of a page. Use <PaperCode>as="h1"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subheader</PaperCode></td>
                        <td>7 (24 px), 600</td>
                        <td>A section of a page. Use <PaperCode>as="h2"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td>6 (22 px), 700</td>
                        <td>The title at the top of a page or a wizard step.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>subtitle</PaperCode></td>
                        <td>3 (16 px), 500</td>
                        <td>A line under a title.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>heading</PaperCode></td>
                        <td>2 (14 px), 700, subdued color</td>
                        <td>The heading over a group of cards or rows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>section</PaperCode></td>
                        <td>1 (12 px), 700, subdued, uppercase, letter-spaced</td>
                        <td>An overline above a menu or list group.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td>4 (18 px), 600</td>
                        <td>The name of one card, row, or empty state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td>3 (16 px), 400</td>
                        <td>A sentence of app copy.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>body</PaperCode></td>
                        <td>3 (16 px), 400, roomy line height</td>
                        <td>Long reading, such as documentation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>hint</PaperCode></td>
                        <td>2 (14 px), 400, subdued color</td>
                        <td>Supporting text: descriptions, status, counts, notes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>error</PaperCode></td>
                        <td>2 (14 px), 400, danger color</td>
                        <td>A failure shown next to what failed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>caption</PaperCode></td>
                        <td>1 (12 px), 500</td>
                        <td>The smallest text, such as a caption under an image.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="anchor-links">Anchor links</PaperText>
            <PaperTextList>
                <li>Text with an <PaperCode>id</PaperCode> gets a small link button after its content. Pressing it copies the page's address with <PaperCode>#id</PaperCode> to the clipboard and adds the hash to the history. The button's tooltip reads "Copy link", then "Copied link!" for two seconds.</li>
                <li>This is how the headings in these docs get their links. Give an <PaperCode>id</PaperCode> to text only when you want that button.</li>
                <li>If the clipboard refuses, the failure is written to the console and the button gives no other sign.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="presets-demo">The presets</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="subheader" as="p">Subheader</PaperText>
                    <PaperText preset="title" as="p">Title</PaperText>
                    <PaperText preset="label" as="p">Label</PaperText>
                    <PaperText preset="text" as="p">Text</PaperText>
                    <PaperText preset="hint" as="p">Hint</PaperText>
                    <PaperText preset="error" as="p">Error</PaperText>
                    <PaperText preset="section" as="p">Section</PaperText>
                    <PaperText preset="caption" as="p">Caption</PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="half">
    <PaperText preset="subheader" as="p">Subheader</PaperText>
    <PaperText preset="title" as="p">Title</PaperText>
    <PaperText preset="label" as="p">Label</PaperText>
    <PaperText preset="text" as="p">Text</PaperText>
    <PaperText preset="hint" as="p">Hint</PaperText>
    <PaperText preset="error" as="p">Error</PaperText>
    <PaperText preset="section" as="p">Section</PaperText>
    <PaperText preset="caption" as="p">Caption</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="truncate">Truncating</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="half" maxWidth="field-wide">
                    <PaperText preset="text" as="p" truncate>
                        A long line of text that does not fit and ends in an ellipsis.
                    </PaperText>
                    <PaperText preset="text" as="p" truncate={2}>
                        A longer passage of text that may take two lines before it is cut off with an ellipsis at the end of the second line.
                    </PaperText>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="half" maxWidth="field-wide">
    <PaperText preset="text" as="p" truncate>
        A long line of text that does not fit and ends in an ellipsis.
    </PaperText>
    <PaperText preset="text" as="p" truncate={2}>
        A longer passage of text that may take two lines before it is cut off with an ellipsis at the end of the second line.
    </PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="failure-beside">A failure beside its field</PaperText>
            <PaperText preset="body" as="p">
                Use the <PaperCode>error</PaperCode> preset for a short message next to what failed.
                Use <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> for a message that has a title or needs dismissing.
            </PaperText>
            <PaperCode block language="tsx">
{`import { Show } from "solid-js";
import { PaperText } from "@mileniumhq/paperui";

export function FieldError(props: { message: string | undefined }) {
    return (
        <Show when={props.message}>
            <PaperText preset="error" as="p" role="alert">{props.message}</PaperText>
        </Show>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Text from a model, a file, or a server that is written in Markdown is <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>.</li>
                <li>HTML you already have as markup is wrapped in <PaperLink href="/docs/paperui/paperprose/">PaperProse</PaperLink>.</li>
                <li>Code in a sentence or a block is <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
