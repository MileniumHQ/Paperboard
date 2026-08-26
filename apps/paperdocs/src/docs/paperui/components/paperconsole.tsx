import {
    PaperButton,
    PaperCode,
    PaperConsole,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    type PaperConsoleEntry,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([
        { type: "command", content: "status" },
        { type: "output", content: "Service active (running) on port 8080" },
        { type: "return", content: "status: 200 OK" },
        { type: "command", content: "run build" },
        {
            type: "warn",
            content: "Source directory contains 2 untracked files",
        },
        { type: "output", content: "Compiled in 240ms" },
    ]);

    const handleCommand = (cmd: string) => {
        const trimmed = cmd.trim();
        if (!trimmed) return;

        if (trimmed === "clear") {
            setEntries([]);
            return;
        }

        if (trimmed === "help") {
            setEntries((prev) => [
                ...prev,
                { type: "command", content: cmd },
                {
                    type: "output",
                    content:
                        "Available commands:\n  status       - Display service metrics\n  ping         - Test round-trip latency\n  warn <msg>   - Output a warning\n  error <msg>  - Output an error\n  clear        - Clear console buffer",
                },
            ]);
            return;
        }

        if (trimmed === "status") {
            setEntries((prev) => [
                ...prev,
                { type: "command", content: cmd },
                {
                    type: "output",
                    content:
                        "Uptime: 2h 15m · Memory: 180 MB · Tasks: 4 active",
                },
                { type: "return", content: "health: nominal" },
            ]);
            return;
        }

        if (trimmed === "ping") {
            setEntries((prev) => [
                ...prev,
                { type: "command", content: cmd },
                { type: "output", content: "pong (8ms)" },
                { type: "return", content: "latency: 8" },
            ]);
            return;
        }

        if (trimmed.startsWith("warn ")) {
            setEntries((prev) => [
                ...prev,
                { type: "command", content: cmd },
                { type: "warn", content: trimmed.slice(5) },
            ]);
            return;
        }

        if (trimmed.startsWith("error ")) {
            setEntries((prev) => [
                ...prev,
                { type: "command", content: cmd },
                { type: "error", content: trimmed.slice(6) },
            ]);
            return;
        }

        setEntries((prev) => [
            ...prev,
            { type: "command", content: cmd },
            { type: "output", content: `Command executed: ${cmd}` },
        ]);
    };

    return (
        <>
            <PaperText preset="header">PaperConsole</PaperText>
            <PaperText preset="body">
                <strong>PaperConsole</strong> is an interactive terminal and command execution interface providing semantic entry formatting, history navigation, and bottom-anchored scrolling.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperConsole is a stream-oriented terminal and log viewer component. It formats log entries using semantic types (<PaperCode>command</PaperCode>,{" "}
                <PaperCode>output</PaperCode>, <PaperCode>error</PaperCode>,{" "}
                <PaperCode>warn</PaperCode>, <PaperCode>info</PaperCode>,{" "}
                <PaperCode>return</PaperCode>) and includes an integrated command input with command history navigation.
            </PaperText>

            <PaperSeparator />

            <PaperText id="basic-usage" preset="subheader">
                Basic usage
            </PaperText>
            <PaperText preset="body">
                The console receives an array of entries and dispatches
                submitted commands through the <PaperCode>onCommand</PaperCode>{" "}
                callback:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperConsole } from "@paperboard-dev/paperui";

<PaperConsole
    banner="Session active"
    entries={entries()}
    onCommand={(cmd) => handleCommand(cmd)}
    placeholder="Enter command..."
/>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <div style={{ width: "100%" }}>
                        <PaperConsole
                            banner="Session active"
                            entries={entries()}
                            onCommand={handleCommand}
                            placeholder="Enter command..."
                        />
                    </div>
                    <PaperFlex direction="row" gap="half">
                        <PaperButton
                            compact
                            variant="blue"
                            onClick={() => handleCommand("ping")}
                        >
                            Send Ping
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="yellow"
                            onClick={() =>
                                handleCommand("warn Connection degraded")
                            }
                        >
                            Log Warning
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="red"
                            onClick={() =>
                                handleCommand(
                                    "error Process terminated unexpectedly",
                                )
                            }
                        >
                            Log Error
                        </PaperButton>
                        <PaperButton compact onClick={() => setEntries([])}>
                            Clear Buffer
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="entry-types" preset="subheader">
                Entry types and content
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>type</PaperCode> property on each entry controls
                the leading icon indicator and background highlight:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Prefix Icon</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            <PaperCode>"command"</PaperCode>
                        </td>
                        <td>
                            <PaperCode>chevron_right</PaperCode>
                        </td>
                        <td>User-submitted command input.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>"output"</PaperCode>
                        </td>
                        <td>
                            <em>None</em>
                        </td>
                        <td>Standard command output line.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>"return"</PaperCode>
                        </td>
                        <td>
                            <PaperCode>chevron_left</PaperCode>
                        </td>
                        <td>Evaluation return value or exit status.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>"error"</PaperCode>
                        </td>
                        <td>
                            <PaperCode>cancel</PaperCode>
                        </td>
                        <td>Error message with tinted background.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>"warn"</PaperCode>
                        </td>
                        <td>
                            <PaperCode>warning</PaperCode>
                        </td>
                        <td>Warning notice with tinted background.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>"info"</PaperCode>
                        </td>
                        <td>
                            <PaperCode>info</PaperCode>
                        </td>
                        <td>Informational message.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="body">
                String entry <PaperCode>content</PaperCode> supports ANSI escape sequences: recognized SGR codes are parsed into styled segments and rendered as colored spans, so program output carrying color codes displays with its original coloring. Non-string content (JSX elements) is rendered as provided.
            </PaperText>
            <PaperText preset="body">
                Each entry also accepts an optional <PaperCode>timestamp</PaperCode> field (<PaperCode>string | Date | number</PaperCode>); the value is accepted by the entry type but is not currently rendered.
            </PaperText>

            <PaperSeparator />

            <PaperText id="features" preset="subheader">
                Features
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    Auto-scroll: The container automatically
                    maintains bottom scroll position as entries are added.
                    Disable with <PaperCode>autoScroll={false}</PaperCode>.
                </PaperText>
                <PaperText preset="body">
                    Dividers: Horizontal lines are rendered
                    between entries by default. Disable with{" "}
                    <PaperCode>divided={false}</PaperCode>.
                </PaperText>
                <PaperText preset="body">
                    History navigation: Pressing{" "}
                    <PaperCode>ArrowUp</PaperCode> and{" "}
                    <PaperCode>ArrowDown</PaperCode> cycles through previous
                    command inputs.
                </PaperText>
                <PaperText preset="body">
                    Static content: Optional <PaperCode>children</PaperCode> are rendered inside the output area after all entries, which is useful for appending fixed status lines or custom elements beneath the log buffer.
                </PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-console" preset="title">
                PaperConsole Props
            </PaperText>
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
                        <td>
                            <PaperCode>entries</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                (PaperConsoleEntry | string)[]
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>[]</PaperCode>
                        </td>
                        <td>
                            Array of log entries or text strings to display.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onCommand</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(command: string) =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Callback fired when a command is submitted.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>banner</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Header text or element displayed at the top of the
                            output buffer.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>divided</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>true</PaperCode>
                        </td>
                        <td>
                            Displays horizontal divider lines between entries.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>placeholder</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"Enter command..."</PaperCode>
                        </td>
                        <td>Input placeholder text.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>prompt</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string | JSX.Element</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"chevron_right"</PaperCode>
                        </td>
                        <td>Leading prompt icon or element.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>inputDisabled</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>Disables command input.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>autoScroll</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>true</PaperCode>
                        </td>
                        <td>Maintains bottom scroll anchoring on update.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>value</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Controlled input value.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onInputChange</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(value: string) =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>Callback fired when input text changes.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperinput">PaperInput</PaperLink>{" "}
                    — Text input control.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercode">PaperCode</PaperLink> —
                    Formatted syntax-highlighted code block.
                </PaperText>
            </PaperTextList>
        </>
    );
}
