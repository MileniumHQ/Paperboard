import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function DaemonCliDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Server daemon reference</PaperText>
            <PaperText preset="body" as="p">
                Every command, option, environment variable and exit code of <PaperCode>papercrane</PaperCode>, the Paperboard server daemon, version 0.3.0.
                The same list is printed by <PaperCode>papercrane --help</PaperCode>, and the options of one command by <PaperCode>papercrane &lt;command&gt; --help</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="sh">
{`papercrane [command] [options]`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>serve</PaperCode> is the default command, so <PaperCode>papercrane --headless</PaperCode> is the same as <PaperCode>papercrane serve --headless</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="commands">Commands</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>serve</PaperCode></td><td>Starts the daemon. In a terminal it shows its own screen; with <PaperCode>--headless</PaperCode> it prints log lines instead.</td></tr>
                    <tr><td><PaperCode>pair</PaperCode></td><td>Opens pairing on the daemon running for the data directory, prints the code, and waits until a computer pairs.</td></tr>
                    <tr><td><PaperCode>status</PaperCode></td><td>Shows whether a daemon is running for the data directory, with its version, PID, address and paired computers.</td></tr>
                    <tr><td><PaperCode>install-service</PaperCode></td><td>Installs, turns on and starts the daemon as a systemd (Linux) or launchd (macOS) service. On Windows it prints Task Scheduler commands.</td></tr>
                    <tr><td><PaperCode>uninstall-service</PaperCode></td><td>Stops the service and removes it. The data directory is kept.</td></tr>
                    <tr><td><PaperCode>help [command]</PaperCode></td><td>Prints help for the program or for one command.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="serve">serve</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Default</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--port &lt;port&gt;</PaperCode></td><td><PaperCode>45464</PaperCode>, or <PaperCode>PAPERCRANE_PORT</PaperCode></td><td>The port to listen on, a whole number from 0 to 65535. <PaperCode>0</PaperCode> picks any free port.</td></tr>
                    <tr><td><PaperCode>--host &lt;address&gt;</PaperCode></td><td><PaperCode>0.0.0.0</PaperCode>, or <PaperCode>PAPERCRANE_HOST</PaperCode></td><td>The address to listen on. <PaperCode>0.0.0.0</PaperCode> is every network. <PaperCode>127.0.0.1</PaperCode> keeps it to this computer.</td></tr>
                    <tr><td><PaperCode>--data-dir &lt;path&gt;</PaperCode></td><td><PaperCode>~/.paperboard</PaperCode>, or <PaperCode>PAPERBOARD_DIR</PaperCode></td><td>Where the daemon keeps its data. Sets <PaperCode>PAPERBOARD_DIR</PaperCode> for the daemon and every program it starts.</td></tr>
                    <tr><td><PaperCode>--headless</PaperCode></td><td>off</td><td>No screen. Prints log lines on standard output. Use it under a service manager.</td></tr>
                    <tr><td><PaperCode>--start-pairing</PaperCode></td><td>off</td><td>Shows a pairing code as soon as the screen opens. Cannot be combined with <PaperCode>--headless</PaperCode>: run <PaperCode>papercrane pair</PaperCode> instead.</td></tr>
                    <tr><td><PaperCode>--no-auth</PaperCode></td><td>off</td><td>Turns off pairing and tokens, so any program on this computer can control the daemon. Only accepted with a loopback <PaperCode>--host</PaperCode> such as <PaperCode>127.0.0.1</PaperCode>. For development on a single-user computer.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The daemon's screen takes three keys: <PaperCode>p</PaperCode> shows a pairing code, <PaperCode>r</PaperCode> removes a paired computer, and <PaperCode>s</PaperCode> stops the daemon. While a code is shown, <PaperCode>c</PaperCode> cancels pairing.
            </PaperText>
            <PaperCode block language="sh">
{`papercrane                              # start with the interactive screen
papercrane --start-pairing              # start and show a pairing code right away
papercrane --headless --port 45465      # run as a service on another port
papercrane --host 127.0.0.1             # only accept this computer`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="pair">pair</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Default</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--data-dir &lt;path&gt;</PaperCode></td><td><PaperCode>~/.paperboard</PaperCode>, or <PaperCode>PAPERBOARD_DIR</PaperCode></td><td>Which daemon to pair: the one running for this data directory.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                It prints the code as <PaperCode>Pairing code: 821 480</PaperCode> with the address to type in Paperboard, then waits.
                It exits 0 after a computer pairs, and 130 after Ctrl+C, which also closes pairing.
                It exits 1 when pairing ends without a computer pairing, when the daemon runs with <PaperCode>--no-auth</PaperCode>, or when no daemon is running.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="status">status</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Default</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--data-dir &lt;path&gt;</PaperCode></td><td><PaperCode>~/.paperboard</PaperCode>, or <PaperCode>PAPERBOARD_DIR</PaperCode></td><td>Which daemon to ask about.</td></tr>
                    <tr><td><PaperCode>--json</PaperCode></td><td>off</td><td>Prints the status as JSON.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="text">
{`The Paperboard server daemon is running.
  Version    0.3.0
  PID        48211
  Listening  https://192.168.1.50:45464
  Data       /home/ada/.paperboard
  Paired     1 computer`}
            </PaperCode>
            <PaperText preset="body" as="p">
                It exits 0 when a daemon is running and 3 when none is. With <PaperCode>--json</PaperCode>:
            </PaperText>
            <PaperCode block language="json">
{`{
  "running": true,
  "dataDir": "/home/ada/.paperboard",
  "version": "0.3.0",
  "hostname": "homeserver",
  "pid": 48211,
  "listen": {
    "url": "https://192.168.1.50:45464",
    "host": "0.0.0.0",
    "port": 45464,
    "secure": true
  },
  "auth": true,
  "pairing": {
    "active": false,
    "computers": [
      { "name": "ada-laptop", "pairedAt": "2026-11-04T13:56:02.114Z" }
    ]
  }
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                When no daemon is running, the JSON is <PaperCode>{`{ "running": false, "dataDir": "/home/ada/.paperboard" }`}</PaperCode> and nothing else.
                <PaperCode>auth</PaperCode> is false for a daemon started with <PaperCode>--no-auth</PaperCode>, and then <PaperCode>pairing</PaperCode> is left out.
                <PaperCode>pairing.active</PaperCode> is true while a code is waiting to be entered.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="install-service">install-service</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Default</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--port &lt;port&gt;</PaperCode></td><td><PaperCode>45464</PaperCode></td><td>The port the service's daemon listens on.</td></tr>
                    <tr><td><PaperCode>--host &lt;address&gt;</PaperCode></td><td><PaperCode>0.0.0.0</PaperCode></td><td>The address the service's daemon listens on.</td></tr>
                    <tr><td><PaperCode>--data-dir &lt;path&gt;</PaperCode></td><td><PaperCode>PAPERBOARD_DIR</PaperCode> in your terminal, else <PaperCode>~/.paperboard</PaperCode> of the account it runs as</td><td>The service's data directory, written into the service. <PaperCode>--data-dir</PaperCode> wins over <PaperCode>PAPERBOARD_DIR</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--system</PaperCode></td><td>off</td><td>A system service that starts at boot. Needs root.</td></tr>
                    <tr><td><PaperCode>--run-as &lt;user&gt;</PaperCode></td><td>The account that ran <PaperCode>sudo</PaperCode></td><td>With <PaperCode>--system</PaperCode> only: the account the daemon runs as.</td></tr>
                    <tr><td><PaperCode>--name &lt;name&gt;</PaperCode></td><td><PaperCode>papercrane</PaperCode></td><td>The service name: letters, digits, <PaperCode>.</PaperCode>, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>, at most 64. On macOS the job is labeled <PaperCode>dev.paperboard.&lt;name&gt;</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--dry-run</PaperCode></td><td>off</td><td>Prints the file it would write and the commands it would run. Changes nothing.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The service runs the daemon with <PaperCode>--headless</PaperCode>, restarts it after a crash, and stops only the daemon process, never the programs its panels started.
                It must run from the downloaded program: a daemon run from Paperboard's source code refuses.
                A user service refuses to install as root, and a system service refuses without root.
                The full walkthrough is <PaperLink href="/docs/paperboard/run-as-service/">Run the daemon as a service</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="uninstall-service">uninstall-service</PaperText>
            <PaperText preset="body" as="p">
                Takes <PaperCode>--system</PaperCode>, <PaperCode>--name &lt;name&gt;</PaperCode> and <PaperCode>--dry-run</PaperCode>, with the same meaning as for <PaperCode>install-service</PaperCode>.
                It stops the service, then deletes its file. It exits 1 when no such service is installed.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="environment">Environment variables</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>What it sets</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>PAPERBOARD_DIR</PaperCode></td><td>The data directory, like <PaperCode>--data-dir</PaperCode>. The option wins when both are given.</td></tr>
                    <tr><td><PaperCode>PAPERCRANE_PORT</PaperCode></td><td>The port <PaperCode>serve</PaperCode> listens on when <PaperCode>--port</PaperCode> is not given.</td></tr>
                    <tr><td><PaperCode>PAPERCRANE_HOST</PaperCode></td><td>The address <PaperCode>serve</PaperCode> listens on when <PaperCode>--host</PaperCode> is not given.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="exit-codes">Exit codes</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>0</PaperCode></td><td>Success.</td></tr>
                    <tr><td><PaperCode>1</PaperCode></td><td>The command ran and failed. The reason is printed.</td></tr>
                    <tr><td><PaperCode>2</PaperCode></td><td>The command line was wrong: an unknown option or command, a bad value, or <PaperCode>--headless</PaperCode> with <PaperCode>--start-pairing</PaperCode>. It prints the error and the usage. Nothing starts.</td></tr>
                    <tr><td><PaperCode>3</PaperCode></td><td><PaperCode>status</PaperCode> only: no daemon is running for the data directory.</td></tr>
                    <tr><td><PaperCode>130</PaperCode></td><td><PaperCode>pair</PaperCode> was cancelled with Ctrl+C.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="text">
{`$ papercrane --port abc
error: option '--port <port>' argument 'abc' is invalid. --port must be a whole number from 0 to 65535, not "abc".
Usage: papercrane [serve] [options]
Run "papercrane --help" for details.`}
            </PaperCode>

            <PaperText preset="body" as="p">
                The files the daemon keeps are listed in <PaperLink href="/docs/paperboard/data-directory/">The data directory</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
