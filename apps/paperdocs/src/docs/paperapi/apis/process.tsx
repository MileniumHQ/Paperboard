import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ProcessApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">processApi</PaperText>
            <PaperText preset="body" as="p">
                processApi starts programs on the computer the panel runs on, through the daemon, and streams their output back.
                It works on a panel page, in a widget and in a service. A process started with it is not the caller's child: it keeps running after the page closes, the service restarts or the daemon restarts.
                Use <PaperCode>exec</PaperCode> for a command that finishes, and <PaperCode>start</PaperCode> for a program that keeps running, such as a game server.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { processApi } from "@mileniumhq/paperapi";

// a command that finishes
const version = await processApi.exec("java", ["-version"]);
if (version.exitCode !== 0) throw new Error(\`java -version failed: \${version.stderr}\`);

// a program that keeps running
if (!(await processApi.exists("weather-relay"))) {
    await processApi.start({ id: "weather-relay", command: relayPath, args: ["--port", "8080"] });
}
const stop = processApi.onData("weather-relay", (text) => appendLog(text));
processApi.onExit("weather-relay", (exitCode) => showStopped(exitCode));
await processApi.write("weather-relay", "status\\n");`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="commands-that-finish">Commands that finish</PaperText>
            <PaperCode block language="tsx">
{`processApi.exec(
    command: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; execBufferCapBytes?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }>;

processApi.run(options: ProcessRunOptions, timeoutMs?: number | null): Promise<ProcessRunResult>;

interface ProcessRunOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** stdout and stderr together */
    onData?: (text: string) => void;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
}

interface ProcessRunResult {
    exitCode: number;
    /** set when the run timed out */
    code?: "RUN_TIMEOUT";
}`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>exec</PaperCode> collects the output and resolves with it trimmed, once the command exits. Each stream keeps at most <PaperCode>execBufferCapBytes</PaperCode>, 10 MiB by default.</li>
                <li><PaperCode>exec</PaperCode> rejects with <PaperCode>RUN_TIMEOUT: "&lt;command&gt;" exceeded &lt;n&gt;ms and was killed</PaperCode> after <PaperCode>timeoutMs</PaperCode>, 30 seconds by default.</li>
                <li><PaperCode>run</PaperCode> streams the output to the callbacks. After <PaperCode>timeoutMs</PaperCode>, 30 seconds by default, it sends <PaperCode>SIGTERM</PaperCode> and resolves with <PaperCode>{"{ exitCode: -1, code: \"RUN_TIMEOUT\" }"}</PaperCode>. Pass <PaperCode>null</PaperCode> to wait with no deadline.</li>
                <li>A command that exits with an error code resolves; check <PaperCode>exitCode</PaperCode>.</li>
                <li>A command that isn't found resolves with <PaperCode>exitCode: -2</PaperCode> and <PaperCode>[Process Error] Executable not found in $PATH: "&lt;command&gt;"</PaperCode> on standard error.</li>
                <li>The command runs directly, not through a shell, so pipes, <PaperCode>&amp;&amp;</PaperCode> and globs are not read. To run a shell line, use <PaperLink href="/docs/paperapi/shell/">resolveOneShotShell</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="long-running-processes">Long-running processes</PaperText>
            <PaperCode block language="tsx">
{`processApi.start(options: ProcessStartOptions): Promise<{ success: boolean }>;
processApi.exists(id: string): Promise<boolean>;
/** subscribes this connection to a running process's output again */
processApi.attach(id: string): Promise<{ success: boolean }>;
processApi.write(id: string, data: string): Promise<void>;
processApi.kill(id: string, signal?: string): Promise<void>;

processApi.onData(id: string, callback: (text: string) => void): () => void;
processApi.onStdout(id: string, callback: (text: string) => void): () => void;
processApi.onStderr(id: string, callback: (text: string) => void): () => void;
processApi.onExit(id: string, callback: (exitCode?: number) => void): () => void;

interface ProcessStartOptions {
    /** names the process for every later call; at most 128 characters */
    id: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** false starts it with its input closed; writes to it then fail */
    stdin?: boolean;
    /** how written text reaches it; "utf16le" for a Windows program that reads UTF-16 */
    inputEncoding?: "utf8" | "utf16le";
    /** Windows: an empty console in place of a pipe, for a program that fails on a pipe; writes fail */
    consoleInput?: boolean;
}`}
            </PaperCode>
            <PaperTextList>
                <li>The id belongs to the panel that started it. Another panel's calls with that id are refused.</li>
                <li>Starting an id that is running rejects with <PaperCode>Process &lt;id&gt; is already running</PaperCode>. Check <PaperCode>exists</PaperCode> first, as the sample does, so a page reopened later picks up the same process.</li>
                <li>Subscribe with <PaperCode>onData</PaperCode> and the others before <PaperCode>start</PaperCode> to see the first lines. Each returns the function that unsubscribes.</li>
                <li>Subscribing with <PaperCode>onData</PaperCode>, <PaperCode>onStdout</PaperCode> or <PaperCode>onStderr</PaperCode> attaches the connection to the process, so a new page or a restarted service sees the output of a process that was already running. <PaperCode>attach</PaperCode> does the same with no callback. After a reconnect, the SDK attaches again.</li>
                <li><PaperCode>write</PaperCode> sends text as it is, with no newline added, at most 64 KB a call.</li>
                <li><PaperCode>kill</PaperCode> sends the signal, <PaperCode>SIGTERM</PaperCode> by default. It resolves even when the id is not running, and logs a refused kill to the console.</li>
                <li>Installing or updating a panel stops every process it owns.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="environment">Environment</PaperText>
            <PaperTextList>
                <li>The process gets the daemon's environment, without its credentials, plus <PaperCode>env</PaperCode>. <PaperCode>env</PaperCode> holds at most 128 entries.</li>
                <li><PaperCode>PAPERCRANE_TOKEN</PaperCode>, <PaperCode>PAPERCRANE_PANEL_TOKEN</PaperCode> and <PaperCode>PAPERBOARD_PANEL_ID</PaperCode> can't be set: the daemon issues credentials, and a process never chooses its own.</li>
                <li><PaperCode>cwd</PaperCode> defaults to the home folder of the account running the daemon. A folder that doesn't exist is refused.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Process &lt;id&gt; is already running</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td><PaperCode>start</PaperCode> with a running id.</td></tr>
                    <tr><td><PaperCode>Process "&lt;id&gt;" is not running</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td><PaperCode>write</PaperCode> to a process that exited or never started.</td></tr>
                    <tr><td><PaperCode>Process "&lt;id&gt;" was started with no input; it can't be written to</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td><PaperCode>write</PaperCode> to a process started with <PaperCode>stdin: false</PaperCode> or <PaperCode>consoleInput</PaperCode>.</td></tr>
                    <tr><td><PaperCode>spawn cwd does not exist: &lt;path&gt;</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A missing <PaperCode>cwd</PaperCode>.</td></tr>
                    <tr><td><PaperCode>overriding "&lt;key&gt;" in a spawned child env is refused</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>A credential key in <PaperCode>env</PaperCode>.</td></tr>
                    <tr><td><PaperCode>"&lt;id&gt;" belongs to another panel</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>Another panel started that id.</td></tr>
                    <tr><td><PaperCode>Invalid parameter: env exceeds 128 entries</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>Too many <PaperCode>env</PaperCode> entries.</td></tr>
                    <tr><td><PaperCode>RUN_TIMEOUT: "&lt;command&gt;" exceeded &lt;n&gt;ms and was killed</PaperCode></td><td>No code</td><td><PaperCode>exec</PaperCode> ran past its timeout.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Import it as <PaperCode>processApi</PaperCode>. The <PaperCode>process</PaperCode> alias hides Node's global <PaperCode>process</PaperCode> in the file that imports it.
            </PaperText>
        </PaperFlex>
    );
}
