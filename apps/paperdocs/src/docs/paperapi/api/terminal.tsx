import {
    PaperCode,
    PaperContainer,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Terminal API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>terminal</PaperCode> namespace: creating interactive pseudo-terminal sessions inside the host and streaming their output.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>Terminal API</strong> spawns real PTY sessions (a user's default shell, or any command with a controlling terminal) managed by the host. Output arrives as raw text including ANSI escape sequences, which makes the API a direct fit for terminal emulators such as xterm.js.
            </PaperText>
            <PaperText preset="body">
                Sessions are identified by caller-supplied string ids. All subsequent calls — write, resize, event subscription, destroy — address a session by that id. Ids should be unique per panel; reusing an existing id destroys the previous session first.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Output format">
                Terminal output is unprocessed: ANSI colors, cursor movement, and control characters are all preserved. Render it in a VT-compatible emulator rather than as plain text.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`import { terminal } from "@paperboard-dev/paperapi";

const termId = "main-shell";

await terminal.create(termId, {
    cols: 80,
    rows: 24,
    // cwd and env are optional
});

terminal.onData(termId, (data) => {
    // feed each chunk into a terminal emulator buffer
});

terminal.write(termId, "ls -la\\r");

// Later:
terminal.resize(termId, 120, 40);
terminal.destroy(termId);`}
            </PaperCode>

            <PaperContainer>
                <PaperCode block language="tsx">
                    {`// Checking whether a session is still alive
const running = await terminal.exists(termId);`}
                </PaperCode>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="reference" preset="subheader">
                Reference
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
                        <td><PaperCode>(id, options?) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Spawns a shell session. Options: cols (80), rows (24), cwd, env.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>(id, data) =&gt; void</PaperCode></td>
                        <td>Writes input to the session as if typed by the user.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resize</PaperCode></td>
                        <td><PaperCode>(id, cols, rows) =&gt; void</PaperCode></td>
                        <td>Resizes the pseudo-terminal.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>destroy</PaperCode></td>
                        <td><PaperCode>(id) =&gt; void</PaperCode></td>
                        <td>Kills the session and releases its resources.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>(id) =&gt; Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Returns whether the session is running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onData</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Subscribes to raw output chunks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExit</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Subscribes to session exit; receives the exit code.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/process">Process API</PaperLink> — Supervised background processes without a terminal.
                </PaperText>
            </PaperTextList>
        </>
    );
}
