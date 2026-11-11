import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function InstallDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Install Paperboard</PaperText>
            <PaperText preset="body" as="p">
                Download the Paperboard desktop app for Windows, macOS or Linux and open it.
                It includes everything it needs to run panels on the computer you install it on.
                For a computer without a screen, install the server daemon instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="terminal">Install from a terminal</PaperText>
            <PaperText preset="body" as="p">
                One command downloads the right file for your computer, checks it against the release's checksums, and installs it. On Linux or macOS:
            </PaperText>
            <PaperCode block language="sh">
{`curl -fsSL https://i.paperboard.dev | sh`}
            </PaperCode>
            <PaperText preset="body" as="p">
                On Windows, in PowerShell:
            </PaperText>
            <PaperCode block language="text">
{`irm https://i.paperboard.dev | iex`}
            </PaperCode>
            <PaperText preset="body" as="p">
                With Node.js 18 or newer, <PaperCode>npx @mileniumhq/paperboard install</PaperCode> and <PaperCode>npm install -g @mileniumhq/paperboard</PaperCode> run the same installer.
                <PaperCode>npx @mileniumhq/paperboard</PaperCode> opens Paperboard, and asks to install it first if it isn't installed. <PaperCode>npx @mileniumhq/paperboard web</PaperCode> opens it in your browser.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Computer</th>
                        <th>What it installs</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Windows</td><td>Paperboard's installer, run for your account only.</td></tr>
                    <tr><td>macOS</td><td>Paperboard.app, in <PaperCode>/Applications</PaperCode>. Quit Paperboard first if it's running.</td></tr>
                    <tr><td>Debian, Ubuntu</td><td>The deb, with apt. It asks for your password through sudo.</td></tr>
                    <tr><td>Fedora, openSUSE</td><td>The rpm, with dnf or zypper. It asks for your password through sudo.</td></tr>
                    <tr><td>Any other Linux</td><td>The AppImage, in <PaperCode>~/.local/share/paperboard</PaperCode>, with an applications menu entry and the <PaperCode>paperboard</PaperCode> command in <PaperCode>~/.local/bin</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                To pick the Linux format yourself, set <PaperCode>PAPERBOARD_INSTALL_AS</PaperCode> to <PaperCode>deb</PaperCode>, <PaperCode>rpm</PaperCode> or <PaperCode>appimage</PaperCode>.
                Running it again updates Paperboard to the latest release.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="download">Download</PaperText>
            <PaperText preset="body" as="p">
                Pick the file for your computer. The same links are on the <PaperLink href="/downloads/">Downloads</PaperLink> page.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Computer</th>
                        <th>File</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Windows, x64</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe">paperboard-windows-x64-setup.exe</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Mac with Apple silicon (M1 and later)</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip">paperboard-macos-arm64.zip</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Mac with an Intel processor</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip">paperboard-macos-x64.zip</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Linux, x64 (AppImage)</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage">paperboard-linux-x64.AppImage</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Linux, ARM64 (AppImage)</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.AppImage">paperboard-linux-arm64.AppImage</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Debian and Ubuntu, x64</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb">paperboard-linux-x64.deb</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Debian and Ubuntu, ARM64</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.deb">paperboard-linux-arm64.deb</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Fedora and openSUSE, x64</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-x64.rpm">paperboard-linux-x64.rpm</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Fedora and openSUSE, ARM64</td>
                        <td><PaperLink href="https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.rpm">paperboard-linux-arm64.rpm</PaperLink></td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The Windows and macOS builds have no developer signature from Microsoft or Apple yet.
                Your computer warns you the first time you open them, and the steps below show how to get past the warning.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="windows">Windows</PaperText>
            <PaperTextList ordered>
                <li>Open <PaperCode>paperboard-windows-x64-setup.exe</PaperCode>.</li>
                <li>If Windows says it protected your PC, select <b>More info</b> and check that this is the file you downloaded.</li>
                <li>Select <b>Run anyway</b>. The installer adds Paperboard to the Start menu and the desktop, then opens it.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Smart App Control or a managed work computer can block the installer without offering <b>Run anyway</b>.
                In that case, ask your administrator or use another computer.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="macos">macOS</PaperText>
            <PaperTextList ordered>
                <li>Open the downloaded zip. It unpacks to <b>Paperboard</b>.</li>
                <li>Move <b>Paperboard</b> to the Applications folder and open it.</li>
                <li>If macOS says it cannot verify the developer, open <b>System Settings</b>, then <b>Privacy &amp; Security</b>.</li>
                <li>Find the message about Paperboard, select <b>Open Anyway</b>, and confirm with <b>Open</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                If macOS says the app is damaged or will harm your computer, stop and <PaperLink href="/contact/">contact us</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="linux">Linux</PaperText>
            <PaperText preset="body" as="p">
                Linux has three downloads. The AppImage runs on any distribution, and the deb and rpm install through your package manager.
            </PaperText>
            <PaperText preset="subheader" as="h3" id="linux-appimage">AppImage</PaperText>
            <PaperText preset="body" as="p">
                The AppImage is the whole app in one file. It needs FUSE 2, which you install from your distribution's packages if it is missing.
                Make the file executable, then open it. From a terminal in the folder you downloaded it to:
            </PaperText>
            <PaperCode block language="sh">
{`chmod +x paperboard-linux-x64.AppImage
./paperboard-linux-x64.AppImage`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The first line marks the file as a program. The second opens Paperboard.
                Keep the AppImage where it is: Paperboard updates the file in place.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="linux-deb">Debian and Ubuntu</PaperText>
            <PaperText preset="body" as="p">
                Install the deb with apt, from the folder you downloaded it to. Use the ARM64 file on an ARM computer.
            </PaperText>
            <PaperCode block language="sh">
{`sudo apt install ./paperboard-linux-x64.deb`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="linux-rpm">Fedora and openSUSE</PaperText>
            <PaperText preset="body" as="p">
                Install the rpm with your package manager, from the folder you downloaded it to. Use the ARM64 file on an ARM computer.
            </PaperText>
            <PaperCode block language="sh">
{`sudo dnf install ./paperboard-linux-x64.rpm`}
            </PaperCode>
            <PaperText preset="body" as="p">
                On openSUSE, use <PaperCode>sudo zypper install ./paperboard-linux-x64.rpm</PaperCode>.
            </PaperText>
            <PaperText preset="body" as="p">
                Both packages add Paperboard to your applications menu and start it with the <PaperCode>paperboard</PaperCode> command.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="first-start">The first start</PaperText>
            <PaperText preset="body" as="p">
                Paperboard checks for updates each time it opens.
            </PaperText>
            <PaperText preset="body" as="p">
                Everything Paperboard keeps is in one folder, <PaperCode>.paperboard</PaperCode> in your home folder.
                See <PaperLink href="/docs/paperboard/data-directory/">The data directory</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="closing-and-quitting">Closing and quitting</PaperText>
            <PaperText preset="body" as="p">
                Closing the window keeps Paperboard running in the system tray, so panels on this computer keep running.
                The tray icon shows how many panels are running. Click it to open the window again.
            </PaperText>
            <PaperText preset="body" as="p">
                To quit, choose <b>Quit Paperboard</b> from the tray menu, or <b>Quit App</b> in <b>Settings</b>.
                Quitting stops the panels running on this computer. Panels on your other computers keep running.
            </PaperText>
            <PaperText preset="body" as="p">
                To keep this computer's panels running with the app quit, run the server daemon here as a service.
                Paperboard finds a daemon that is already running for its data directory and uses it instead of starting its own.
                See <PaperLink href="/docs/paperboard/run-as-service/">Run the daemon as a service</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="start-with-your-computer">Start with your computer</PaperText>
            <PaperText preset="body" as="p">
                Turn on <b>Run on startup</b> in <b>Settings</b>. Paperboard then opens when you sign in.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="updates">Updates</PaperText>
            <PaperText preset="body" as="p">
                Each time Paperboard opens, it checks for a new version of the app, of every installed panel, and of the server daemon on your connected computers.
                It skips the check when the last one finished less than 30 minutes ago.
            </PaperText>
            <PaperTextList>
                <li>A new app version downloads in the background. When it is ready, <b>Restart to update</b> appears at the top of the window.</li>
                <li>Panel, package and computer updates run in the background. While they run, the top bar shows how many are left; select it to see each one.</li>
                <li>To check right away, open <b>Settings</b> and select <b>Update everything now</b>.</li>
                <li>An update of something a panel is running, such as a game server, waits instead of stopping it. The top bar shows <b>1 update is waiting</b>. Select it, then <b>Stop and update</b>: the panel stops what it runs, the update installs, and the panel starts it again.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Paperboard installed on Linux from its deb or rpm updates the same way: the new package downloads in the background, and <b>Restart to update</b> installs it with your package manager.
                Installing a package needs your password, so your computer asks for it first.
                On a computer without <PaperCode>pkexec</PaperCode>, which asks for it, Paperboard tells you when a new version is out, and <b>Download update</b> gets the new package to install over the old one.
                Paperboard installed by a package that isn't ours updates through the package manager it came from.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/panels/">install your first panel</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
