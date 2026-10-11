import {
    PaperCard,
    PaperCode,
    PaperEditor,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { createSignal } from "solid-js";

function EditorDemo() {
    const [text, setText] = createSignal("motd: Hello\nmax-players: 20\nwhitelist:\n  - Alex\n  - Steve\n");
    return (
        <PaperCard padding="double" surface="front">
            <PaperEditor value={text()} onChange={setText} language="yaml" aria-label="Server settings" />
        </PaperCard>
    );
}

export default function PaperEditorDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperEditor</PaperText>
            <PaperText preset="body">
                PaperEditor is a plain-text code editor with line numbers and syntax colors.
                Reach for PaperEditor when a panel edits a config file, a script, or any other text where indentation matters.
                It is a real textarea, so the caret, selection, undo, input methods and screen readers work as they do in any text field.
            </PaperText>
            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass value and onChange. Name a language to color the text.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperEditor } from "@mileniumhq/paperui";

export function Example() {
    const [text, setText] = createSignal("motd: Hello\\nmax-players: 20\\n");
    return (
        <PaperEditor
            value={text()}
            onChange={setText}
            language="yaml"
            aria-label="Server settings"
            onSave={() => console.log("save", text())}
        />
    );
}`}
            </PaperCode>
            <EditorDemo />
            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The text. A new value from outside replaces what is shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(value: string) =&gt; void</PaperCode></td>
                        <td>no default</td>
                        <td>Called with the whole text after each edit.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>plain text</td>
                        <td>A language id, such as yaml, toml, properties or json. See PaperCode for the list.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>highlight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Colors the text when the language has a grammar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>lineNumbers</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows a number beside each line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>wrap</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Wraps long lines instead of scrolling sideways.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>readOnly</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Shows the text without letting it change.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>indent</PaperCode></td>
                        <td><PaperCode>"auto" | "tab" | number</PaperCode></td>
                        <td><PaperCode>"auto"</PaperCode></td>
                        <td>What Tab inserts: what the text already uses, a tab, or a number of spaces from 1 to 8.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onSave</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>no default</td>
                        <td>Called on Ctrl+S or Cmd+S.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onCursorChange</PaperCode></td>
                        <td><PaperCode>(position: PaperEditorPosition) =&gt; void</PaperCode></td>
                        <td>no default</td>
                        <td>Called with the caret's line and column, both counted from 1.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>textareaRef</PaperCode></td>
                        <td><PaperCode>(el: HTMLTextAreaElement) =&gt; void</PaperCode></td>
                        <td>no default</td>
                        <td>Receives the textarea element.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                PaperEditor also takes id, class, classList, aria-label, aria-labelledby and aria-describedby. Give it an accessible name with one of the aria props.
            </PaperText>
            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Tab and Shift+Tab indent and outdent the selected lines. Press Escape and then Tab to move focus out of the editor. A read-only editor does not capture Tab.
                Enter keeps the current line's indent. It adds one level after a line ending in &#123; or [, and after a key ending in a colon in YAML.
                Text longer than PAPER_EDITOR_HIGHLIGHT_LIMIT (200,000 characters) is shown without colors, because coloring it again on every keystroke would make typing lag.
                Line numbers and the colored copy of the text are hidden from assistive devices, which read the textarea alone.
            </PaperText>
            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                The editing rules are exported for code that edits text outside the component. Each returns a TextEdit: the range to replace, the text to insert, and where the selection ends up.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>detectIndent</PaperCode></td>
                        <td><PaperCode>detectIndent(text, fallback?): string</PaperCode></td>
                        <td>The indent unit a text already uses: a tab, or two to eight spaces. Returns the fallback (four spaces) when the text has no indented lines.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>indentEdit</PaperCode></td>
                        <td><PaperCode>indentEdit(text, start, end, unit, outdent): TextEdit | null</PaperCode></td>
                        <td>Indents or outdents every line the selection touches. Returns null when nothing would change.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>newlineEdit</PaperCode></td>
                        <td><PaperCode>newlineEdit(text, start, end, unit, language?): TextEdit</PaperCode></td>
                        <td>A new line that keeps the current indent.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>caretPosition</PaperCode></td>
                        <td><PaperCode>caretPosition(text, pos): &#123; line, column &#125;</PaperCode></td>
                        <td>The line and column of a text offset, both counted from 1.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
