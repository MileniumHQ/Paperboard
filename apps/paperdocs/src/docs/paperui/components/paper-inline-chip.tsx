import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInlineChip,
    PaperLink,
    PaperPreview,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const notes = URL.createObjectURL(new Blob(["# Notes\n\nA file named in a sentence opens in a preview.\n"], { type: "text/plain" }));

export default function PaperInlineChipDoc() {
    const [open, setOpen] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperInlineChip</PaperText>
            <PaperText preset="body" as="p">
                PaperInlineChip is a button that sits in a line of text, like a file named in a sentence.
                It shows an icon and a label, and it is exactly one line tall, so the paragraph's line spacing does not change.
                What a press does is yours to decide, such as opening the file in a <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put the chip inside a <PaperCode>PaperText</PaperCode> paragraph.
                Pass an icon name in <PaperCode>icon</PaperCode> and the label as children.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperText preset="body" as="p">
                    The steps are in <PaperInlineChip icon="description" onClick={() => setOpen(true)}>notes.md</PaperInlineChip> if you need them again.
                </PaperText>
                <PaperPreview open={open()} onClose={() => setOpen(false)} src={notes} name="notes.md" type="text/markdown" />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperInlineChip, PaperPreview, PaperText } from "@mileniumhq/paperui";

export function Example(props: { url: string }) {
    const [open, setOpen] = createSignal(false);

    return (
        <>
            <PaperText preset="body" as="p">
                The steps are in{" "}
                <PaperInlineChip icon="description" onClick={() => setOpen(true)}>
                    notes.md
                </PaperInlineChip>{" "}
                if you need them again.
            </PaperText>
            <PaperPreview open={open()} onClose={() => setOpen(false)} src={props.url} name="notes.md" />
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperInlineChipProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode> without <PaperCode>children</PaperCode>.
                Other props land on the <PaperCode>button</PaperCode>, so <PaperCode>onClick</PaperCode>, <PaperCode>disabled</PaperCode>, and <PaperCode>aria-label</PaperCode> work as on any button.
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
                        <td>Required, no default</td>
                        <td>The label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default (no icon)</td>
                        <td>An icon name, drawn with PaperIcon, or an element, before the label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"button" | "submit" | "reset"</PaperCode></td>
                        <td><PaperCode>"button"</PaperCode></td>
                        <td>The button type, so a chip in a form does not submit it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Stops presses and dims the chip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid class props</td>
                        <td>No default</td>
                        <td>Added to the button.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The chip takes the font, size, and line height of the text around it. Its padding is only at the sides, so the line box keeps the height it had.</li>
                <li>The icon is sized by <PaperCode>--paper-inline-icon-scale</PaperCode> (1.15em), so it is a little larger than the text and still no taller than the line.</li>
                <li>A long label is cut short with an ellipsis. The chip never grows wider than its container.</li>
                <li>A disabled chip is dimmed and shows the default cursor.</li>
                <li>It has a focus ring for the keyboard and a darker tint on hover or press.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="disabled">Disabled</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperText preset="body" as="p">
                    The file <PaperInlineChip icon="description" disabled>report.pdf</PaperInlineChip> is still uploading.
                </PaperText>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperText preset="body" as="p">
    The file <PaperInlineChip icon="description" disabled>report.pdf</PaperInlineChip> is still uploading.
</PaperText>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="from-markdown">Inside Markdown</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink> can turn its own links into chips with <PaperCode>renderLink</PaperCode>.
                See Panel-owned links on that page.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A link that goes to an address is <PaperLink href="/docs/paperui/paperlink/">PaperLink</PaperLink>.</li>
                <li>A button on its own line is <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink>.</li>
                <li>A pill button with a pressed state, outside a line of text, is <PaperLink href="/docs/paperui/paperchip/">PaperChip</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
