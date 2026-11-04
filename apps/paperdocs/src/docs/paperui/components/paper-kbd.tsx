import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperKbd,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperKbdDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperKbd</PaperText>
            <PaperText preset="body" as="p">
                PaperKbd shows a keyboard key as a small raised key cap.
                Use it in hints and instructions to name a key or shortcut, such as Enter or Ctrl and S.
                It is display only: it does not listen for keys.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put one key in each PaperKbd and place it inline in a sentence.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperText preset="body" as="p">
                    Press <PaperKbd>Ctrl</PaperKbd> + <PaperKbd>S</PaperKbd> to save, or <PaperKbd>Esc</PaperKbd> to cancel.
                </PaperText>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperKbd, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperText preset="body" as="p">
                Press <PaperKbd>Ctrl</PaperKbd> + <PaperKbd>S</PaperKbd> to save, or <PaperKbd>Esc</PaperKbd> to cancel.
            </PaperText>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperKbdProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLElement&gt;</PaperCode> and adds nothing.
                Other props land on the <PaperCode>kbd</PaperCode> element.
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
                        <td>The key's label, such as <PaperCode>Enter</PaperCode> or <PaperCode>⌘</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The element is a semantic <PaperCode>kbd</PaperCode>, so the text is marked up as keyboard input.</li>
                <li>The cap is inline-flex, bold, in the code font, at least 1.6 em wide so a single character is square, with a small margin on each side.</li>
                <li>Combinations are written by the author: one PaperKbd per key, with a plain <PaperCode>+</PaperCode> between them. The component does not join keys or change them per platform, so choose Ctrl or Cmd to match the user.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="hint">A hint under a field</PaperText>
            <PaperCode block language="tsx">
{`import { PaperKbd, PaperText } from "@mileniumhq/paperui";

<PaperText preset="hint">
    Press <PaperKbd>Enter</PaperKbd> to send and <PaperKbd>Shift</PaperKbd> + <PaperKbd>Enter</PaperKbd> for a new line.
</PaperText>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                A shortcut that belongs to a menu row goes in the item's <PaperCode>keybind</PaperCode> prop on <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink>.
                Use <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink> for commands and identifiers.
            </PaperText>
        </PaperFlex>
    );
}
