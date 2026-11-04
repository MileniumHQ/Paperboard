import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperEditor,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const starter = `name: Panel
version: 1.0.0
ports:
  - 8080
  - 8443
`;

export default function PaperEditorDoc() {
    const [value, setValue] = createSignal(starter);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperEditor</PaperText>
            <PaperText preset="body" as="p">
                PaperEditor is a plain-text code editor with syntax highlighting, line numbers, and indent-aware keys.
                Use it to edit a configuration file, a script, or any text a panel holds as a string.
                It edits text only: it has no tabs, search, or multiple cursors.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the text in <PaperCode>value</PaperCode> and receive edits in <PaperCode>onChange</PaperCode>.
                The editor fills its parent's height, so put it in a parent with a bounded height.
            </PaperText>
            <PaperCard data-docs-demo padding="none" height="field-wide" surface="front">
                <PaperEditor
                    value={value()}
                    onChange={setValue}
                    language="yaml"
                    aria-label="Configuration"
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperEditor } from "@mileniumhq/paperui";

const starter = \`name: Panel
version: 1.0.0
ports:
  - 8080
  - 8443
\`;

export function Example() {
    const [value, setValue] = createSignal(starter);

    return (
        <PaperCard padding="none" height="field-wide" surface="front">
            <PaperEditor
                value={value()}
                onChange={setValue}
                language="yaml"
                aria-label="Configuration"
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperEditorProps is its own interface, not an HTML attribute set: props not listed here are not forwarded.
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
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The text. The editor keeps its own copy while the user types. When this prop changes to a different string, such as another file opening, the editor replaces its text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(value: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the full text after each edit, including the editor's own indent and newline edits.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (plain text)</td>
                        <td>A highlighting grammar id: the ones listed on <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>, such as <PaperCode>yaml</PaperCode>, <PaperCode>toml</PaperCode>, <PaperCode>json</PaperCode>, <PaperCode>properties</PaperCode>, <PaperCode>bash</PaperCode>. An unknown id draws plain text. It also tunes Enter for <PaperCode>yaml</PaperCode> and <PaperCode>yml</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>highlight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td><PaperCode>false</PaperCode> draws plain text even when <PaperCode>language</PaperCode> has a grammar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>lineNumbers</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows a number column.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>wrap</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Soft-wraps long lines. Without it long lines scroll sideways. Numbers stay aligned with their line either way.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>readOnly</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Blocks edits and sets <PaperCode>aria-readonly</PaperCode>. Tab then moves focus on instead of indenting.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>indent</PaperCode></td>
                        <td><PaperCode>"auto" | "tab" | number</PaperCode></td>
                        <td><PaperCode>"auto"</PaperCode></td>
                        <td>What Tab inserts. <PaperCode>"tab"</PaperCode> is a tab character. A number is that many spaces, clamped to 1 through 8. <PaperCode>"auto"</PaperCode> follows the text: a tab when most indented lines start with one, otherwise the smallest leading run of spaces (2 to 8), and four spaces for text with no indentation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onSave</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called on Ctrl+S or Cmd+S. The editor cancels the browser's save dialog for the key whether or not a handler is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onCursorChange</PaperCode></td>
                        <td><PaperCode>(pos: PaperEditorPosition) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with <PaperCode>{"{ line, column }"}</PaperCode>, both 1-based, when the caret moves, on focus, and after edits.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Set on the text area, so a <PaperCode>label</PaperCode> element can point at it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Set on the text area. Give the editor this or <PaperCode>aria-labelledby</PaperCode>: it has no visible label of its own.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-labelledby</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Set on the text area. The id of the element that names the editor.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-describedby</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Set on the text area. The id of the element that describes it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>textareaRef</PaperCode></td>
                        <td><PaperCode>(el: HTMLTextAreaElement) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Receives the text area, for focus or selection control.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The editor is a native <PaperCode>textarea</PaperCode> laid over a highlighted copy of the text, so caret, selection, undo, IME, and screen readers behave as in any text field. The highlighted copy is hidden from assistive technology.</li>
                <li>Tab and Shift+Tab indent and outdent the caret's line or every line a selection touches. Pressing Escape and then Tab moves focus out of the editor, so keyboard users are not trapped.</li>
                <li>Enter keeps the current line's indent. It adds one more level after a line ending in <PaperCode>{"{"}</PaperCode> or <PaperCode>[</PaperCode>, and after a YAML <PaperCode>key:</PaperCode> line when <PaperCode>language</PaperCode> is <PaperCode>yaml</PaperCode> or <PaperCode>yml</PaperCode>.</li>
                <li>Indent and newline edits go through the browser's insert command, so one Ctrl+Z undoes one edit. Where the browser has no such command, the edit still applies but is not in the undo history.</li>
                <li>Above 200,000 characters (<PaperCode>PAPER_EDITOR_HIGHLIGHT_LIMIT</PaperCode>) the editor draws plain text, so typing stays responsive.</li>
                <li>Spellcheck, autocapitalize, and autocomplete are off.</li>
                <li>The root is <PaperCode>height: 100%</PaperCode> and scrolls inside, so give its parent a height.</li>
                <li>The editor has no <PaperCode>disabled</PaperCode> state, no placeholder, and no error display. Validate the text yourself and show the problem next to the editor.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="exports">Related exports</PaperText>
            <PaperText preset="body" as="p">
                The package also exports the pure functions behind the keys, for tests or custom editors: <PaperCode>detectIndent</PaperCode>, <PaperCode>indentEdit</PaperCode>, <PaperCode>newlineEdit</PaperCode>, <PaperCode>caretPosition</PaperCode>, and the <PaperCode>TextEdit</PaperCode> type.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="save">Edit and save a file</PaperText>
            <PaperText preset="body" as="p">
                Keep the draft in a signal, save on Ctrl+S, and show a failed save to the user.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperCard, PaperEditor, PaperQuote } from "@mileniumhq/paperui";

export function ConfigEditor(props: {
    initial: string;
    save: (text: string) => Promise<void>;
}) {
    const [draft, setDraft] = createSignal(props.initial);
    const [failure, setFailure] = createSignal("");

    const save = async () => {
        try {
            await props.save(draft());
            setFailure("");
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <>
            <Show when={failure()}>
                <PaperQuote variant="danger" icon="warning" title="Not saved" onDismiss={() => setFailure("")}>
                    {failure()}
                </PaperQuote>
            </Show>
            <PaperCard grow minHeight={0} padding="none">
                <PaperEditor
                    value={draft()}
                    onChange={setDraft}
                    onSave={() => void save()}
                    language="properties"
                    aria-label="server.properties"
                />
            </PaperCard>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="read-only">A read-only view with a caret readout</PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperEditor, PaperText, type PaperEditorPosition } from "@mileniumhq/paperui";

export function Viewer(props: { text: string }) {
    const [position, setPosition] = createSignal<PaperEditorPosition>({ line: 1, column: 1 });

    return (
        <>
            <PaperEditor
                value={props.text}
                language="json"
                readOnly
                wrap
                onCursorChange={setPosition}
                aria-label="File contents"
            />
            <PaperText preset="hint">
                Line {position().line}, column {position().column}
            </PaperText>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                Use <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink> for a single-line or short multi-line field, and <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink> to display code the user does not edit.
            </PaperText>
        </PaperFlex>
    );
}
