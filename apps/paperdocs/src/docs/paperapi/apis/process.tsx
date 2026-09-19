import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function ProcessApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Process API</PaperText>
            <PaperText preset="body">
                processApi executes host commands and supervises background child processes with streamed input and output.
                Reach for processApi when running compilers, invoking git commands, running scripts, or managing worker daemons.
                All execution routes use argv array spawning without shell string interpolation.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import processApi or process from @paperboard-dev/paperapi.
                Execute one-shot commands using exec or supervise long-lived children using run and start.
            </PaperText>
            <PaperCode block language="tsx">
{`import { processApi } from "@paperboard-dev/paperapi";

// Execute a one-shot command
const { stdout, exitCode } = await processApi.exec("git", ["status", "--short"]);
console.log("Git status:", stdout);`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module provides the following process management methods:
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
                        <td><PaperCode>exec</PaperCode></td>
                        <td><PaperCode>exec(command, args?, options?): Promise&lt;ExecResult&gt;</PaperCode></td>
                        <td>Executes a command and buffers stdout and stderr until completion.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>run</PaperCode></td>
                        <td><PaperCode>run(options, timeoutMs?): Promise&lt;ProcessRunResult&gt;</PaperCode></td>
                        <td>Runs a child process with streaming callbacks for stdout, stderr, and exit codes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>start</PaperCode></td>
                        <td><PaperCode>start(options): Promise&lt;{"{ success: boolean }"}&gt;</PaperCode></td>
                        <td>Starts a supervised background process identified by an explicit process ID.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>kill</PaperCode></td>
                        <td><PaperCode>kill(id, signal?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Sends a termination signal (default SIGTERM) to a supervised process.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>exists(id): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Checks whether a background process ID is actively running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStdout</PaperCode></td>
                        <td><PaperCode>onStdout(id, callback): () =&gt; void</PaperCode></td>
                        <td>Subscribes to standard output text events from the child process.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStderr</PaperCode></td>
                        <td><PaperCode>onStderr(id, callback): () =&gt; void</PaperCode></td>
                        <td>Subscribes to standard error text events from the child process.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExit</PaperCode></td>
                        <td><PaperCode>onExit(id, callback): () =&gt; void</PaperCode></td>
                        <td>Subscribes to exit events providing the integer exit code.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Arguments must be supplied as discrete array items; arguments are never passed to sh -c with string interpolation.
                Buffered exec calls enforce a default memory cap of 10 megabytes. If a command times out, the child is killed and throws a RUN_TIMEOUT error.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Stream output chunks in real time as the process generates them.
            </PaperText>
            <PaperCode block language="tsx">
{`await processApi.run({
    command: "bun",
    args: ["test"],
    onStdout: (chunk) => console.log(chunk),
    onStderr: (errChunk) => console.error(errChunk),
});`}
            </PaperCode>
        </PaperFlex>
    );
}
