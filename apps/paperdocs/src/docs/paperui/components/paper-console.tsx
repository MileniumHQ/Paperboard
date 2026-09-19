import {
    PaperCard,
    PaperCode,
    PaperConsole,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperConsoleDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperConsole</PaperText>
            <PaperText preset="body">
                PaperConsole renders an interactive terminal log interface with command entry and ANSI color parsing.
                Reach for PaperConsole when inspecting live background logs, running REPL environments, or observing process outputs.
                The console provides command history recall and automatic scroll anchoring.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Supply log messages through the entries prop or pass preformatted content through the text prop.
                Listen to user submissions using the onCommand callback.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperConsole, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    const entries = [
        { type: "info" as const, content: "Service initialized" },
        { type: "command" as const, content: "status" },
        { type: "output" as const, content: "System running" },
    ];

    return (
        <PaperCard padding="none" surface="front">
            <PaperConsole
                title="Console"
                entries={entries}
                placeholder="Enter command"
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="none" surface="front">
                <PaperConsole
                    title="Console"
                    entries={[
                        { type: "info", content: "Service initialized" },
                        { type: "command", content: "status" },
                        { type: "output", content: "System running" },
                    ]}
                    placeholder="Enter command"
                />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperConsole exposes configuration for entry presentation, inputs, and history:
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
                            <td><PaperCode>entries</PaperCode></td>
                            <td><PaperCode>(PaperConsoleEntry | string)[]</PaperCode></td>
                            <td><PaperCode>[]</PaperCode></td>
                            <td>List of console rows containing content, entry type, and timestamps.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onCommand</PaperCode></td>
                            <td><PaperCode>(command: string) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Invoked when the user submits a command string from the input field.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Header title text displayed above the log stream.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onClear</PaperCode></td>
                            <td><PaperCode>() =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>When set, renders a clear button in the console header.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>showInput</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>When false, renders the log stream in read-only mode without the input bar.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>text</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Preformatted raw text block rendered as a single log view.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>autoScroll</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Automatically scrolls the output pane to the bottom when new items arrive.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The command line maintains a ring buffer of the last 200 entered commands.
                Pressing the ArrowUp and ArrowDown keys cycles through prior commands.
                ANSI escape codes in text entries are converted into colored spans.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render a read-only stream by setting showInput to false.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperConsole
    title="Build log"
    showInput={false}
    entries={[
        { type: "info", content: "Compiling artifacts" },
        { type: "output", content: "Build succeeded" },
    ]}
/>`}
            </PaperCode>
            <PaperCard padding="none" surface="front">
                <PaperConsole
                    title="Build log"
                    showInput={false}
                    entries={[
                        { type: "info", content: "Compiling artifacts" },
                        { type: "output", content: "Build succeeded" },
                    ]}
                />
            </PaperCard>
        </PaperFlex>
    );
}
