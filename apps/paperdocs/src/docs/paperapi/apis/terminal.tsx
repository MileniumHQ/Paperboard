import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function TerminalApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">terminalApi</PaperText>
            <PaperText preset="body" as="p">
                terminalApi opens an interactive shell on the computer the panel runs on, in a pseudo-terminal the daemon keeps running.
                It works on a panel page, in a widget and in a service, and pairs with a terminal view such as xterm.js on the page.
                For a program the panel drives itself, use <PaperLink href="/docs/paperapi/process/">processApi</PaperLink> instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { terminalApi } from "@mileniumhq/paperapi";

const id = "weather-shell";
const stopData = terminalApi.onData(id, (text) => term.write(text));
const stopExit = terminalApi.onExit(id, (exitCode) => showEnded(exitCode));

if (!(await terminalApi.exists(id))) {
    await terminalApi.create(id, { cols: term.cols, rows: term.rows });
}

term.onData((keys) => terminalApi.write(id, keys).catch((err) => showError(err.message)));
term.onResize(({ cols, rows }) => terminalApi.resize(id, cols, rows).catch((err) => showError(err.message)));`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`terminalApi.create(id: string, options?: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string> }): Promise<void>;
terminalApi.exists(id: string): Promise<boolean>;
terminalApi.write(id: string, data: string): Promise<void>;
terminalApi.resize(id: string, cols: number, rows: number): Promise<void>;
terminalApi.destroy(id: string): Promise<void>;

terminalApi.onData(id: string, callback: (text: string) => void): () => void;
terminalApi.onExit(id: string, callback: (exitCode?: number) => void): () => void;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>create</PaperCode></td>
                        <td>Starts the shell, 80 by 24 unless <PaperCode>cols</PaperCode> and <PaperCode>rows</PaperCode> say otherwise. Rejects with the daemon's reason when the shell could not start.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td>Sends keystrokes as they are, at most 64 KB a call. Rejects with <PaperCode>Terminal "&lt;id&gt;" is not running</PaperCode> once the shell has ended.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resize</PaperCode></td>
                        <td>Changes the size the shell sees. A shell that has ended ignores it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>destroy</PaperCode></td>
                        <td>Ends the shell. Resolves when the shell has already ended. Rejects with the daemon's reason when the shell would not stop.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onData</PaperCode></td>
                        <td>Subscribes to the output, and attaches the connection to a shell that was already running. Each callback returns the function that unsubscribes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExit</PaperCode></td>
                        <td>Calls back with the shell's exit code when it ends.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The shell is <PaperCode>powershell.exe</PaperCode> on Windows. On macOS it is <PaperCode>/bin/zsh</PaperCode>, then <PaperCode>/bin/bash</PaperCode>, then <PaperCode>/bin/sh</PaperCode>. On Linux it is <PaperCode>$SHELL</PaperCode>, then bash, then <PaperCode>/bin/sh</PaperCode>.</li>
                <li><PaperCode>cwd</PaperCode> defaults to the home folder of the account running the daemon.</li>
                <li>The shell keeps running when the page closes and when the daemon restarts. Open the page again, subscribe with <PaperCode>onData</PaperCode>, and it picks up where it was.</li>
                <li>The id belongs to the panel that created it, at most 128 characters. Another panel's calls with that id are refused.</li>
                <li><PaperCode>env</PaperCode> follows the same rules as a process: at most 128 entries, and no credential keys. See <PaperLink href="/docs/paperapi/process/#environment">Environment</PaperLink>.</li>
                <li>A terminal runs whatever the person types with the daemon account's rights. Show it only to the person who owns the computer.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>create</PaperCode> and <PaperCode>destroy</PaperCode> never reject. Their failures reach only the console, such as <PaperCode>Process &lt;id&gt; is already running</PaperCode> for a second <PaperCode>create</PaperCode>, <PaperCode>spawn cwd does not exist: &lt;path&gt;</PaperCode>, or a refused credential key in <PaperCode>env</PaperCode>.
                <PaperCode>write</PaperCode> rejects with <PaperCode>Terminal "&lt;id&gt;" is not running</PaperCode>. <PaperCode>write</PaperCode>, <PaperCode>resize</PaperCode> and <PaperCode>exists</PaperCode> reject with <PaperCode>"&lt;id&gt;" belongs to another panel</PaperCode> (<PaperCode>FORBIDDEN</PaperCode>) for another panel's id.
            </PaperText>
        </PaperFlex>
    );
}
