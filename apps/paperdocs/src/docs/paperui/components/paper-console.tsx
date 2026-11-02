import { createSignal, onCleanup } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperConsole,
    PaperEmptyState,
    PaperFlex,
    PaperTable,
    PaperText,
    type PaperConsoleEntry,
} from "@mileniumhq/paperui";

const STREAM_CAP = 5000;
const STREAM_TYPES = ["output", "output", "info", "output", "warn", "output", "error"] as const;

function streamLine(i: number): PaperConsoleEntry {
    return { type: STREAM_TYPES[i % STREAM_TYPES.length], content: `[worker ${i % 8}] processed job ${i}` };
}

function StreamingLogDemo() {
    let next = 0;
    const [entries, setEntries] = createSignal<PaperConsoleEntry[]>(
        Array.from({ length: STREAM_CAP }, () => streamLine(next++)),
    );
    const [timer, setTimer] = createSignal<ReturnType<typeof setInterval>>();

    const toggle = () => {
        const running = timer();
        if (running !== undefined) {
            clearInterval(running);
            setTimer(undefined);
            return;
        }
        // about 500 lines a second, one at a time like a real process
        setTimer(
            setInterval(() => {
                setEntries((prev) => {
                    const all = [...prev, streamLine(next++)];
                    return all.length > STREAM_CAP ? all.slice(all.length - STREAM_CAP) : all;
                });
            }, 2),
        );
    };
    onCleanup(() => clearInterval(timer()));

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperButton onClick={toggle}>{timer() !== undefined ? "Stop stream" : "Start stream"}</PaperButton>
            <PaperCard padding="none" surface="front" height="panel-height-small">
                <PaperConsole title="Worker log" showInput={false} entries={entries()} />
            </PaperCard>
        </PaperFlex>
    );
}

export default function PaperConsoleDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperConsole</PaperText>
            <PaperText preset="body">
                PaperConsole renders an interactive terminal log interface with command entry and ANSI color parsing.
                Reach for PaperConsole when inspecting live background logs, running REPL environments, or observing process outputs.
                The console provides command history recall, follows new output, and stays fast with thousands of lines.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Supply log messages through the entries prop or pass preformatted content through the text prop.
                Listen to user submissions using the onCommand callback.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperConsole, PaperCard } from "@mileniumhq/paperui";

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
                            <td><PaperCode>empty</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Shown in the middle of the output while there are no entries or text, usually a PaperEmptyState.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>autoScroll</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Follows new output while the reader is at the bottom. Scrolling up pauses following until they scroll back down or send a command.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The command line maintains a ring buffer of the last 200 entered commands.
                Pressing the ArrowUp and ArrowDown keys cycles through prior commands.
                ANSI escape codes in text entries are converted into colored spans.
            </PaperText>

            <PaperText preset="subheader" id="large-logs">Large logs</PaperText>
            <PaperText preset="body">
                PaperConsole mounts only the entries near the visible area. The rest of the log is an empty spacer sized from measured row heights, so the scrollbar covers the whole log without rendering it.
                Updates to entries are folded into one render per frame, so a process that prints hundreds of lines a second costs the same as one that prints sixty.
            </PaperText>
            <PaperText preset="body">
                Scroll up while lines stream in and the rows you are reading stay put, even when old entries drop off the front of a capped log.
                Cap entries in your own state. PaperConsole renders a long log cheaply, but the array itself still grows until you trim it.
            </PaperText>
            <PaperCode block language="tsx">
{`const MAX_LINES = 5000;
const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([]);

process.onLine((line) =>
    setEntries((prev) => [...prev, line].slice(-MAX_LINES)),
);

<PaperCard padding="none" surface="front" height="panel-height-small">
    <PaperConsole title="Worker log" showInput={false} entries={entries()} />
</PaperCard>`}
            </PaperCode>
            <StreamingLogDemo />
            <PaperText preset="body">
                The text prop is not windowed. It renders one preformatted block, which suits a log file read once. Use entries for output that keeps arriving.
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
            <PaperText preset="body">
                Say what an empty console means with the empty prop. It shows until the first line arrives.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperConsole
    entries={entries()}
    empty={<PaperEmptyState icon="terminal" title="The server is stopped" description="Start it and what it prints shows up here." />}
/>`}
            </PaperCode>
            <PaperCard padding="none" surface="front" height="panel-height-small">
                <PaperConsole
                    entries={[]}
                    empty={<PaperEmptyState icon="terminal" title="The server is stopped" description="Start it and what it prints shows up here." />}
                />
            </PaperCard>
        </PaperFlex>
    );
}
