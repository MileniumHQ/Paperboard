import {
    PaperCode,
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
            <PaperText preset="header">Process API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>process</PaperCode> namespace: starting supervised background processes, reading their output streams, and managing their lifetime.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>Process API</strong> runs programs as supervised children of the host. Supervision means a process keeps running even if the panel closes or the application restarts, and its output can be reattached later — the model that lets a game server keep serving while its console panel is shut.
            </PaperText>
            <PaperText preset="body">
                Two start styles exist. <PaperCode>process.start()</PaperCode> launches a named, long-lived process addressed by id. <PaperCode>process.run()</PaperCode> launches an anonymous short-lived command and resolves when it exits, returning the exit code.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Streams">
                Output is delivered separately for stdout and stderr, plus a combined data stream. All three are raw text; ANSI sequences are preserved.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="long-lived" preset="subheader">
                Long-lived processes
            </PaperText>
            <PaperCode block language="tsx">
                {`import { process } from "@paperboard-dev/paperapi";

const id = "my-server";

await process.start({
    id,
    command: "java",
    args: ["-jar", "server.jar"],
    cwd: "/path/to/data",
    env: { JAVA_HOME: javaPath },
});

process.onStdout(id, (line) => console.log(line));
process.onStderr(id, (line) => console.error(line));
process.onExit(id, (code) => console.log("exited", code));

// Interact:
process.write(id, "say hello\\n");
process.kill(id); // SIGTERM by default`}
            </PaperCode>

            <PaperText id="reattaching" preset="subheader">
                Reattaching to a running process
            </PaperText>
            <PaperText preset="body">
                If a process was started in an earlier session, <PaperCode>exists</PaperCode> reports whether it is still running and <PaperCode>attach</PaperCode> resumes output delivery:
            </PaperText>
            <PaperCode block language="tsx">
                {`if (await process.exists(id)) {
    await process.attach(id);
    process.onData(id, (text) => console.log(text));
}`}
            </PaperCode>
            <PaperText preset="body">
                Calling <PaperCode>onData</PaperCode> alone also performs this check and attaches automatically.
            </PaperText>

            <PaperText id="one-shot" preset="subheader">
                One-shot commands
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>process.run()</PaperCode> method launches an anonymous command and streams output as it arrives, resolving with the exit code upon termination. For synchronous script execution with automatic stdout/stderr buffering, use <PaperCode>process.exec()</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">
                {`const { stdout, stderr, exitCode } = await process.exec("git", ["status", "--short"]);
if (exitCode === 0) {
    console.log("Status:\\n" + stdout);
}`}
            </PaperCode>
            <PaperCode block language="tsx">
                {`const { exitCode } = await process.run({
    command: "git",
    args: ["status", "--short"],
    onData: (text) => buffer.push(text),
});`}
            </PaperCode>

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
                        <td><PaperCode>start</PaperCode></td>
                        <td><PaperCode>(options: ProcessStartOptions) =&gt; Promise&lt;{"{ success }"}&gt;</PaperCode></td>
                        <td>Starts a named process with id, command, args, cwd, and env.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>run</PaperCode></td>
                        <td><PaperCode>(options: ProcessRunOptions, timeoutMs?) =&gt; Promise&lt;{"{ exitCode }"}&gt;</PaperCode></td>
                        <td>Runs an anonymous command; streams data and resolves on exit.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exec</PaperCode></td>
                        <td><PaperCode>(command: string, args?: string[], options?) =&gt; Promise&lt;{"{ stdout, stderr, exitCode }"}&gt;</PaperCode></td>
                        <td>Executes a command to termination, buffering and returning stdout, stderr, and exit code.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>(id, data) =&gt; void</PaperCode></td>
                        <td>Writes to the process stdin.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>kill</PaperCode></td>
                        <td><PaperCode>(id, signal?) =&gt; void</PaperCode></td>
                        <td>Sends a signal; defaults to SIGTERM.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>(id) =&gt; Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Returns whether the process is running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>attach</PaperCode></td>
                        <td><PaperCode>(id) =&gt; Promise&lt;{"{ success }"}&gt;</PaperCode></td>
                        <td>Reattaches output streaming for a running process.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onData</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Combined stdout and stderr stream; auto-attaches.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStdout</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Standard output stream.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStderr</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Standard error stream.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExit</PaperCode></td>
                        <td><PaperCode>(id, callback) =&gt; void</PaperCode></td>
                        <td>Fires once with the exit code.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/terminal">Terminal API</PaperLink> — Interactive sessions for commands a user types into.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/package">Package API</PaperLink> — Install the runtimes these processes need.
                </PaperText>
            </PaperTextList>
        </>
    );
}
