import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function TerminalApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Terminal API</PaperText>
            <PaperText preset="body">
                terminalApi allocates and manages interactive pseudoterminals with keystroke streaming and viewport resizing.
                Reach for terminalApi when implementing web terminal consoles, interactive debug shells, or SSH sessions.
                The API connects frontend xterm instances with background pty processes over WebSocket channels.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import terminalApi or terminal from @paperboard-dev/paperapi.
                Create a terminal instance using an explicit identifier and subscribe to data events.
            </PaperText>
            <PaperCode block language="tsx">
{`import { terminalApi } from "@paperboard-dev/paperapi";

const termId = "main-shell";

// Create a new pseudoterminal
await terminalApi.create(termId, { cols: 80, rows: 24 });

// Stream incoming terminal data
const unsub = terminalApi.onData(termId, (data) => {
    process.stdout.write(data);
});

// Write input keystrokes
await terminalApi.write(termId, "ls -la\\n");`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module provides the following pseudoterminal methods:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Method</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>create</PaperCode></td>
                        <td><PaperCode>create(id, options?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Allocates a pty child process. Accepts cols, rows, cwd, and env variables.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>write(id, data): Promise&lt;void&gt;</PaperCode></td>
                        <td>Sends input text or control characters to the terminal stdin.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resize</PaperCode></td>
                        <td><PaperCode>resize(id, cols, rows): Promise&lt;void&gt;</PaperCode></td>
                        <td>Notifies the pty process of viewport row and column dimension changes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>destroy</PaperCode></td>
                        <td><PaperCode>destroy(id): Promise&lt;void&gt;</PaperCode></td>
                        <td>Terminates the pty child process and cleans up daemon socket resources.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>exists(id): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Checks whether the specified terminal instance is active.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onData</PaperCode></td>
                        <td><PaperCode>onData(id, callback): () =&gt; void</PaperCode></td>
                        <td>Subscribes to raw text and ANSI stream output. Returns an unsubscriber.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExit</PaperCode></td>
                        <td><PaperCode>onExit(id, callback): () =&gt; void</PaperCode></td>
                        <td>Subscribes to terminal session exit events. Returns an unsubscriber.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Terminal identity is supplied as an explicit argument to prevent options objects from clobbering identifiers.
                Subscriptions are scoped to individual terminal session channels to avoid broadcast overhead.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Synchronize dimensions when the browser window or terminal container resizes.
            </PaperText>
            <PaperCode block language="tsx">
{`window.addEventListener("resize", () => {
    terminalApi.resize("main-shell", terminal.cols, terminal.rows);
});`}
            </PaperCode>
        </PaperFlex>
    );
}
