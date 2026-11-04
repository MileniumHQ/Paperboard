import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function RunAsServiceDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Run the daemon as a service</PaperText>
            <PaperText preset="body" as="p">
                Install the Paperboard server daemon as a service so it runs in the background, starts with the computer, and comes back after a crash.
                One command sets it up on Linux and macOS. On Windows it prints the Task Scheduler commands to run instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>The server daemon program is in the folder it will stay in. See <PaperLink href="/docs/paperboard/server-daemon/">Install the server daemon</PaperLink>. The service runs it from that path.</li>
                <li>No daemon you started by hand is running for the same data directory. Stop it first: <PaperCode>install-service</PaperCode> refuses while one is running.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="install">Install the service</PaperText>
            <PaperText preset="body" as="p">
                Run this as your own account, not with <PaperCode>sudo</PaperCode>:
            </PaperText>
            <PaperCode block language="sh">
{`papercrane install-service`}
            </PaperCode>
            <PaperText preset="body" as="p">
                It writes the service file, turns the service on, starts it, and waits up to 20 seconds for the daemon to answer. Then it prints what it did:
            </PaperText>
            <PaperCode block language="text">
{`Installed the Paperboard server daemon as a user service (papercrane.service).

  Wrote     /home/ada/.config/systemd/user/papercrane.service
  Ran       systemctl --user daemon-reload
            systemctl --user enable papercrane.service
            systemctl --user restart papercrane.service

It is running (PID 48211) on https://192.168.1.50:45464.

  Data      /home/ada/.paperboard
  Logs      journalctl --user -u papercrane -f
            systemctl --user status papercrane
  Pair      papercrane pair
  Remove    papercrane uninstall-service`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Pair it with <PaperCode>papercrane pair</PaperCode>, as shown in <PaperLink href="/docs/paperboard/connect/">Connect a computer</PaperLink>.
                Running <PaperCode>install-service</PaperCode> again updates the service, for example with a new port.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="user-or-system">A user service or a system service</PaperText>
            <PaperText preset="body" as="p">
                By default the service belongs to your account. Add <PaperCode>--system</PaperCode> for a service that starts when the computer boots, with nobody signed in. It needs <PaperCode>sudo</PaperCode>:
            </PaperText>
            <PaperCode block language="sh">
{`sudo papercrane install-service --system`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A system service still runs as the account that typed <PaperCode>sudo</PaperCode>, and keeps its data in that account's home folder.
                Panels run with the daemon's rights, so it never runs as root unless you ask with <PaperCode>--run-as root</PaperCode>.
                Choose another account with <PaperCode>--run-as &lt;user&gt;</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>File it writes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Linux, user</td><td><PaperCode>~/.config/systemd/user/papercrane.service</PaperCode></td></tr>
                    <tr><td>Linux, system</td><td><PaperCode>/etc/systemd/system/papercrane.service</PaperCode></td></tr>
                    <tr><td>macOS, user</td><td><PaperCode>~/Library/LaunchAgents/dev.paperboard.papercrane.plist</PaperCode></td></tr>
                    <tr><td>macOS, system</td><td><PaperCode>/Library/LaunchDaemons/dev.paperboard.papercrane.plist</PaperCode></td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A system service starts at boot. On Linux it waits for the network first.
                A macOS user service runs while you are signed in to the Mac.
            </PaperText>
            <PaperText preset="body" as="p">
                On Linux, a user service stops when your last session ends, which on a headless server is when you close SSH.
                <PaperCode>install-service</PaperCode> tells you when this applies. Turn on lingering to keep it running, putting your user name in place of <PaperCode>ada</PaperCode>:
            </PaperText>
            <PaperCode block language="sh">
{`sudo loginctl enable-linger ada`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Or install a system service instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="options">Port, address and data directory</PaperText>
            <PaperText preset="body" as="p">
                The service starts the daemon with the options you give <PaperCode>install-service</PaperCode>. It does not see the environment variables of the terminal you ran it from, so use the options.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--port &lt;port&gt;</PaperCode></td><td>The port to listen on. Default <PaperCode>45464</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--host &lt;address&gt;</PaperCode></td><td>The address to listen on. Default <PaperCode>0.0.0.0</PaperCode>, every network. <PaperCode>127.0.0.1</PaperCode> keeps it to this computer.</td></tr>
                    <tr><td><PaperCode>--data-dir &lt;path&gt;</PaperCode></td><td>Where the daemon keeps its data. Default <PaperCode>~/.paperboard</PaperCode> of the account it runs as.</td></tr>
                    <tr><td><PaperCode>--name &lt;name&gt;</PaperCode></td><td>The service name, default <PaperCode>papercrane</PaperCode>. Give each daemon its own name, port and data directory to run more than one.</td></tr>
                    <tr><td><PaperCode>--dry-run</PaperCode></td><td>Prints the service file and the commands it would run, and changes nothing.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="sh">
{`papercrane install-service --port 45465 --name papercrane-test --data-dir ~/pb-test`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Every other command for that daemon takes the same <PaperCode>--name</PaperCode> or <PaperCode>--data-dir</PaperCode>: <PaperCode>papercrane pair --data-dir ~/pb-test</PaperCode>, <PaperCode>papercrane uninstall-service --name papercrane-test</PaperCode>.
                All options are listed in the <PaperLink href="/docs/paperboard/daemon-cli/">Server daemon reference</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="manage-the-service">Check, stop and start it</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>papercrane status</PaperCode> shows whether the daemon is running, its version, its address and how many computers are paired.
                Stop, start and read logs with the computer's own service tools:
            </PaperText>
            <PaperText preset="title" as="h3" id="manage-linux">Linux</PaperText>
            <PaperCode block language="sh">
{`journalctl --user -u papercrane -f      # follow the log
systemctl --user stop papercrane        # stop
systemctl --user start papercrane       # start
systemctl --user restart papercrane     # restart`}
            </PaperCode>
            <PaperText preset="title" as="h3" id="manage-macos">macOS</PaperText>
            <PaperCode block language="sh">
{`# follow the log
tail -f ~/Library/Logs/Paperboard/papercrane.log
# stop
launchctl bootout gui/$(id -u)/dev.paperboard.papercrane
# start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.paperboard.papercrane.plist`}
            </PaperCode>
            <PaperText preset="body" as="p">
                To restart on macOS, stop it, then start it.
            </PaperText>
            <PaperText preset="body" as="p">
                For a Linux system service, drop <PaperCode>--user</PaperCode> and put <PaperCode>sudo</PaperCode> in front of <PaperCode>systemctl</PaperCode>.
                For a macOS system service, use <PaperCode>sudo launchctl</PaperCode> with <PaperCode>system</PaperCode> in place of <PaperCode>gui/$(id -u)</PaperCode>, the file in <PaperCode>/Library/LaunchDaemons</PaperCode>, and the log <PaperCode>/Library/Logs/Paperboard/papercrane.log</PaperCode>.
                The daemon also writes <PaperCode>logs/paperboard.log</PaperCode> in its data directory.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="workloads-survive">Game servers keep running through a restart</PaperText>
            <PaperText preset="body" as="p">
                Stopping or restarting the service stops only the daemon.
                Game servers and other programs that panels started keep running, and the next daemon takes them over when it starts.
                The service is set up this way so an update or a crash does not take a game server down.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="updates">Updates</PaperText>
            <PaperText preset="body" as="p">
                When Paperboard checks for updates, it sends a newer server daemon to each connected Linux and macOS computer.
                The daemon checks the release signature and checksum, then puts the new program in place of the old one.
                The new version runs from the next start: restart the service.
            </PaperText>
            <PaperText preset="body" as="p">
                A daemon on Windows does not update itself. Download the new zip and replace the files.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="windows">Windows</PaperText>
            <PaperText preset="body" as="p">
                On Windows, <PaperCode>install-service</PaperCode> changes nothing. It prints the commands that start the daemon when you sign in, with your program's path in them:
            </PaperText>
            <PaperCode block language="text">
{`schtasks /Create /TN "Paperboard server daemon" /SC ONLOGON /RL LIMITED /TR "\\"C:\\Paperboard\\papercrane-windows-x64.exe\\" --headless"`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Run that in a terminal opened with <b>Run as administrator</b>. Remove the task with:
            </PaperText>
            <PaperCode block language="text">
{`schtasks /Delete /TN "Paperboard server daemon"`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="remove">Remove the service</PaperText>
            <PaperCode block language="sh">
{`papercrane uninstall-service`}
            </PaperCode>
            <PaperText preset="body" as="p">
                It stops the daemon, then removes the service file. Add <PaperCode>--system</PaperCode> (with <PaperCode>sudo</PaperCode>) or <PaperCode>--name</PaperCode> to match how you installed it.
                Your data directory stays as it is, and game servers that were running keep running until a daemon starts again and takes them over.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: every command and option in the <PaperLink href="/docs/paperboard/daemon-cli/">Server daemon reference</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
