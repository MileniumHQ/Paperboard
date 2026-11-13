import {
    PaperCode,
    PaperFlex,
    PaperKbd,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ServerDaemonDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Install the server daemon</PaperText>
            <PaperText preset="body" as="p">
                Run the Paperboard server daemon on a computer you want to manage from Paperboard on another computer, such as a headless server.
                It is one program, <PaperCode>papercrane</PaperCode>, that runs panels and waits for Paperboard to connect.
                Download it, start it, and then pair it with your desktop app.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>The computer runs Linux (x64 or ARM64), macOS (Apple silicon or Intel) or Windows (x64).</li>
                <li>You can open a terminal on it, directly or over SSH.</li>
                <li>Paperboard is installed on the computer you will manage it from. See <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                These pages describe version 0.4.0 of the server daemon. Older versions do not have the <PaperCode>pair</PaperCode>, <PaperCode>status</PaperCode> and <PaperCode>install-service</PaperCode> commands.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="download">Download</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Computer</th>
                        <th>File</th>
                        <th>Program inside</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Linux, x64</td>
                        <td><PaperLink href="https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz">crane-linux-x64.tar.gz</PaperLink></td>
                        <td><PaperCode>papercrane-linux-x64</PaperCode></td>
                    </tr>
                    <tr>
                        <td>Linux, ARM64</td>
                        <td><PaperLink href="https://i.paperboard.dev/crane/latest/crane-linux-arm64.tar.gz">crane-linux-arm64.tar.gz</PaperLink></td>
                        <td><PaperCode>papercrane-linux-arm64</PaperCode></td>
                    </tr>
                    <tr>
                        <td>Mac with Apple silicon</td>
                        <td><PaperLink href="https://i.paperboard.dev/crane/latest/crane-macos-arm64.tar.gz">crane-macos-arm64.tar.gz</PaperLink></td>
                        <td><PaperCode>papercrane-macos-arm64</PaperCode></td>
                    </tr>
                    <tr>
                        <td>Mac with an Intel processor</td>
                        <td><PaperLink href="https://i.paperboard.dev/crane/latest/crane-macos-x64.tar.gz">crane-macos-x64.tar.gz</PaperLink></td>
                        <td><PaperCode>papercrane-macos-x64</PaperCode></td>
                    </tr>
                    <tr>
                        <td>Windows, x64</td>
                        <td><PaperLink href="https://i.paperboard.dev/crane/latest/crane-windows-x64.zip">crane-windows-x64.zip</PaperLink></td>
                        <td><PaperCode>papercrane-windows-x64.exe</PaperCode></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="linux-and-macos">Install on Linux or macOS</PaperText>
            <PaperText preset="body" as="p">
                Run these in a terminal on the computer. They use the Linux x64 file. For another computer, put its file and program names from the table in their place.
            </PaperText>
            <PaperCode block language="sh">
{`curl -LO https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz
tar -xzf crane-linux-x64.tar.gz
mkdir -p ~/.local/bin
install -m 755 papercrane-linux-x64 ~/.local/bin/papercrane
~/.local/bin/papercrane --version`}
            </PaperCode>
            <PaperTextList ordered>
                <li><PaperCode>curl</PaperCode> downloads the archive into the current folder.</li>
                <li><PaperCode>tar</PaperCode> unpacks it. It holds one file, the program.</li>
                <li><PaperCode>mkdir</PaperCode> makes the folder <PaperCode>.local/bin</PaperCode> in your home folder, if it is not there yet.</li>
                <li><PaperCode>install</PaperCode> copies the program there under the name <PaperCode>papercrane</PaperCode> and marks it as a program you can run.</li>
                <li><PaperCode>--version</PaperCode> prints the version, which shows it worked.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Keep the program in that folder. A service runs it from the path it was installed from, and the daemon saves its own updates next to it, so the folder must belong to your account.
                Delete the downloaded archive and the unpacked file afterwards.
            </PaperText>
            <PaperText preset="body" as="p">
                These pages write the command as <PaperCode>papercrane</PaperCode>.
                If your terminal answers <PaperCode>command not found</PaperCode>, the folder is not on your PATH: type <PaperCode>~/.local/bin/papercrane</PaperCode> instead.
            </PaperText>
            <PaperText preset="body" as="p">
                On a Mac, a file downloaded with a web browser instead of <PaperCode>curl</PaperCode> is blocked the first time it runs, because it has no Apple developer signature.
                To allow it, open <b>System Settings</b>, then <b>Privacy &amp; Security</b>, and select <b>Open Anyway</b>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="windows">Install on Windows</PaperText>
            <PaperTextList ordered>
                <li>Download <PaperCode>crane-windows-x64.zip</PaperCode>, right-click it and choose <b>Extract All</b>.</li>
                <li>Move <PaperCode>papercrane-windows-x64.exe</PaperCode> where it can stay.</li>
                <li>Open a terminal in that folder and run <PaperCode>.\papercrane-windows-x64.exe</PaperCode>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The first time it starts, Windows Firewall asks whether to allow it on the network. Allow it.
                Without that permission, other computers cannot reach it, and Paperboard reports that it timed out.
                SmartScreen may also warn about an unknown publisher. Select <b>More info</b>, then <b>Run anyway</b>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="start-it">Start it</PaperText>
            <PaperText preset="body" as="p">
                Run <PaperCode>papercrane</PaperCode>. In a terminal it opens its own screen:
            </PaperText>
            <PaperCode block language="text">
{`Paperboard Server
Listening on https://192.168.1.50:45464

Pairing itself is unauthenticated: pair only on a network you trust. Once paired, the connection is encrypted and locked to this server, so you can use it from anywhere.

Paired Computers (0):
  (None)

[p] Pair new computer    [r] Revoke computer    [s] Stop server`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The second line is the address other computers use: this computer's network address and port <PaperCode>45464</PaperCode>.
                Press <PaperKbd>p</PaperKbd> to show a pairing code, <PaperKbd>r</PaperKbd> to remove a paired computer, and <PaperKbd>s</PaperKbd> to stop the daemon.
            </PaperText>
            <PaperText preset="body" as="p">
                The daemon runs as long as this terminal does. To keep it running after you log out, and start it with the computer, run it as a service.
                See <PaperLink href="/docs/paperboard/run-as-service/">Run the daemon as a service</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="network">What the network needs</PaperText>
            <PaperTextList>
                <li>Paperboard connects to the daemon on TCP port <PaperCode>45464</PaperCode>. A firewall on the computer must let that port in. Choose another port with <PaperCode>--port</PaperCode>.</li>
                <li>Paperboard finds daemons on the same local network by multicast DNS. Where that does not reach, such as across networks or through a VPN, connect by address instead.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="npx">Run it with npx</PaperText>
            <PaperText preset="body" as="p">
                On a computer with Node.js 18 or newer, the <PaperCode>@mileniumhq/paperboard</PaperCode> package downloads the server daemon and runs it in one step, without the desktop app:
            </PaperText>
            <PaperCode block language="sh">
{`npx @mileniumhq/paperboard serve`}
            </PaperCode>
            <PaperText preset="body" as="p">
                It downloads the same signed program as the table above, checks its signature and checksum before unpacking it, and keeps it in a folder of its own: <PaperCode>~/.local/share/papercrane/&lt;version&gt;</PaperCode> on Linux, <PaperCode>~/Library/Application Support/papercrane/&lt;version&gt;</PaperCode> on macOS, and <PaperCode>%LOCALAPPDATA%\papercrane\&lt;version&gt;</PaperCode> on Windows.
                Every command but <PaperCode>install</PaperCode>, <PaperCode>web</PaperCode> and <PaperCode>help</PaperCode> goes to the daemon, so <PaperCode>npx @mileniumhq/paperboard pair</PaperCode> and <PaperCode>npx @mileniumhq/paperboard install-service</PaperCode> work too.
                With no command, the package opens the desktop app instead; see <PaperLink href="/docs/paperboard/install/#terminal">Install from a terminal</PaperLink>.
            </PaperText>
            <PaperText preset="body" as="p">
                The package runs server daemon 0.4.0 or newer. If the newest published daemon is older, it stops with an error that names both versions, and downloads nothing.
                A service installed through npx keeps running the version it was installed with. After a new release, run <PaperCode>npx @mileniumhq/paperboard install-service</PaperCode> again to move the service to it.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/connect/">connect the computer to Paperboard</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
