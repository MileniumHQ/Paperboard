import {
    PaperCard,
    PaperCode,
    PaperConsole,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    type PaperConsoleEntry,
} from "@mileniumhq/paperui";

const entries: PaperConsoleEntry[] = [
    { type: "info", content: "Server starting" },
    { type: "output", content: "Loading world" },
    { type: "warn", content: "Config key is deprecated" },
    { type: "command", content: "list" },
    { type: "return", content: "2 players online" },
    { type: "error", content: "Failed to save world" },
];

export default function PaperConsoleDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperConsole</PaperText>
            <PaperText preset="body" as="p">
                PaperConsole is a scrolling log with an optional command line.
                Use it for a server's output, a long log file, or a REPL.
                It renders only the rows near the viewport, so a log of thousands of lines stays fast.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>entries</PaperCode> and, to take commands, <PaperCode>onCommand</PaperCode>.
                The console fills the height its parent gives it and scrolls inside, so put it in a parent with a bounded height, such as a <PaperCode>PaperCard</PaperCode> with <PaperCode>grow</PaperCode> and <PaperCode>minHeight={"{0}"}</PaperCode> in a full-height column.
            </PaperText>
            <PaperCard data-docs-demo padding="full" height="panel-height-small" surface="front">
                <PaperConsole entries={entries} title="Server" showInput={false} />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperConsole, type PaperConsoleEntry } from "@mileniumhq/paperui";

const entries: PaperConsoleEntry[] = [
    { type: "info", content: "Server starting" },
    { type: "output", content: "Loading world" },
    { type: "warn", content: "Config key is deprecated" },
    { type: "command", content: "list" },
    { type: "return", content: "2 players online" },
    { type: "error", content: "Failed to save world" },
];

export function Example() {
    return (
        <PaperCard padding="full" height="panel-height-small" surface="front">
            <PaperConsole entries={entries} title="Server" showInput={false} />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperConsoleProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>onCommand</PaperCode> and <PaperCode>title</PaperCode>, which it declares itself.
                Other props land on the root.
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
                        <td><PaperCode>entries</PaperCode></td>
                        <td><PaperCode>(PaperConsoleEntry | string)[]</PaperCode></td>
                        <td>No default (empty)</td>
                        <td>The log lines, oldest first. A string is an <PaperCode>output</PaperCode> entry. Pass a new array to update; changes within about one frame are folded into one render.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A large preformatted body, such as a log file, drawn as one text node above the entries. Use it instead of <PaperCode>entries</PaperCode> for a file you already hold as a string. It is not windowed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onCommand</PaperCode></td>
                        <td><PaperCode>(command: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the trimmed command when the user submits the input. Empty input is ignored. Errors thrown by the handler are yours to catch and show.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showInput</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td><PaperCode>false</PaperCode> renders a read-only log with no command row.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>Header label. The header appears when <PaperCode>title</PaperCode> or <PaperCode>onClear</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClear</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Adds a <PaperCode>Clear console</PaperCode> icon button to the header. The console does not empty itself: clear the array you pass.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>banner</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Content above the output, such as a welcome line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>empty</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Shown in the middle of the output while there are no entries and no <PaperCode>text</PaperCode>. Usually a <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placeholder</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Enter command..."</PaperCode></td>
                        <td>Placeholder of the command input.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>prompt</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>"chevron_right"</PaperCode></td>
                        <td>The icon at the start of the command input: a Material icon name or an element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>inputDisabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables the command input.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (uncontrolled)</td>
                        <td>The command input's text. When set, you own it: the console does not clear it after a submit.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onInputChange</PaperCode></td>
                        <td><PaperCode>(value: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called on each edit, on history recall, and with <PaperCode>""</PaperCode> after a submit.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>autoScroll</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Follows the newest line. <PaperCode>false</PaperCode> never follows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>divided</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Draws a divider between entries. <PaperCode>false</PaperCode> removes it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Rendered inside the output area after the entries.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="entries">Entries</PaperText>
            <PaperText preset="body" as="p">
                PaperConsoleEntry is <PaperCode>{"{ type?, content, id?, timestamp? }"}</PaperCode>.
                Only <PaperCode>type</PaperCode> and <PaperCode>content</PaperCode> are read: <PaperCode>id</PaperCode> and <PaperCode>timestamp</PaperCode> are in the type but nothing draws or keys on them.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>content</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The line. A string with ANSI color codes is drawn in color (foreground, background, bold, italic, underline). An element is rendered as is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>PaperConsoleEntryType</PaperCode></td>
                        <td><PaperCode>"output"</PaperCode></td>
                        <td>One of <PaperCode>"command"</PaperCode>, <PaperCode>"output"</PaperCode>, <PaperCode>"error"</PaperCode>, <PaperCode>"warn"</PaperCode>, <PaperCode>"info"</PaperCode>, <PaperCode>"return"</PaperCode>. Styles the row. <PaperCode>command</PaperCode> shows a right chevron, <PaperCode>return</PaperCode> a left chevron, <PaperCode>error</PaperCode> a cancel mark, <PaperCode>warn</PaperCode> a warning mark, <PaperCode>info</PaperCode> an info mark, and <PaperCode>output</PaperCode> no mark.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>MAX_CONSOLE_HISTORY</PaperCode> is exported too: it is 200.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The console follows the newest line. Scrolling up away from the bottom stops following, and the view stays where it is while new lines arrive. Scrolling back to the bottom resumes. Submitting a command jumps to the bottom.</li>
                <li>Only rows near the viewport are in the page. Long lines wrap, and the scrollbar still spans the whole log.</li>
                <li>The command input keeps the last 200 submitted commands. The Up arrow recalls older ones, the Down arrow moves back toward the text you were typing.</li>
                <li>The console does not append a typed command to <PaperCode>entries</PaperCode>. Add your own <PaperCode>command</PaperCode> entry in <PaperCode>onCommand</PaperCode> if you want it echoed.</li>
                <li>A string without an escape character has its carriage returns removed. A string with ANSI codes keeps only the text after its last carriage return.</li>
                <li>The root is a flex column that takes the space its parent leaves (<PaperCode>flex: 1 1 auto</PaperCode>, <PaperCode>min-height: 0</PaperCode>). In a parent without a bounded height the output area does not scroll.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="live-server">A server console with commands</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel feeds a signal of entries from the server's output, sends commands to the server, hides the input when the server cannot take commands, and shows an empty state while the log is empty.
                Show a failed command to the user instead of dropping it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import {
    PaperCard,
    PaperConsole,
    PaperEmptyState,
    PaperQuote,
    type PaperConsoleEntry,
} from "@mileniumhq/paperui";

export function ServerConsole(props: { send: (command: string) => Promise<string> }) {
    const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([]);
    const [failure, setFailure] = createSignal("");

    const run = async (command: string) => {
        setEntries((prev) => [...prev, { type: "command", content: command }]);
        try {
            const reply = await props.send(command);
            setEntries((prev) => [...prev, { type: "return", content: reply }]);
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <>
            <Show when={failure()}>
                <PaperQuote variant="danger" icon="warning" title="Command not run" onDismiss={() => setFailure("")}>
                    {failure()}
                </PaperQuote>
            </Show>
            <PaperCard grow minHeight={0} padding="full">
                <PaperConsole
                    entries={entries()}
                    onCommand={(command) => void run(command)}
                    onClear={() => setEntries([])}
                    title="Console"
                    empty={<PaperEmptyState icon="terminal" title="Nothing printed yet" />}
                />
            </PaperCard>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="log-file">A log file</PaperText>
            <PaperText preset="body" as="p">
                Pass the file's lines as <PaperCode>text</PaperCode> for a read-only view, as the gameserver Logs screen does with a filter box above it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperConsole } from "@mileniumhq/paperui";

export function LogView(props: { lines: string[] }) {
    return (
        <PaperCard grow minHeight={0} padding="full">
            <PaperConsole showInput={false} text={props.lines.join("\\n")} />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                PaperConsole draws lines of text and does not interpret cursor control, so it is not a terminal emulator.
                For a few lines of static output, use <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
