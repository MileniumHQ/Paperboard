import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function DataDirectoryDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">The data directory</PaperText>
            <PaperText preset="body" as="p">
                Paperboard keeps everything on a computer in one folder, <PaperCode>.paperboard</PaperCode> in the home folder: panels, their files, settings, secrets and logs.
                The desktop app and the server daemon use the same folder, and each computer has its own.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="where-it-is">Where it is</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Computer</th>
                        <th>Folder</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Linux</td><td><PaperCode>/home/&lt;you&gt;/.paperboard</PaperCode></td></tr>
                    <tr><td>macOS</td><td><PaperCode>/Users/&lt;you&gt;/.paperboard</PaperCode></td></tr>
                    <tr><td>Windows</td><td><PaperCode>C:\Users\&lt;you&gt;\.paperboard</PaperCode></td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The folder name starts with a dot, so file managers on Linux and macOS hide it. In Paperboard, the folder button at the top of the window opens it:
            </PaperText>
            <PaperTextList>
                <li>With a panel open, it opens that panel's files folder.</li>
                <li>On the Computer Info page or the Panel Library, it opens the whole data directory.</li>
                <li>For another computer, it opens the same folder on that computer over the network.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="use-another-folder">Use another folder</PaperText>
            <PaperText preset="body" as="p">
                Set the environment variable <PaperCode>PAPERBOARD_DIR</PaperCode> to a folder path before starting Paperboard or the server daemon. The daemon also takes <PaperCode>--data-dir &lt;path&gt;</PaperCode>.
                A daemon running as a service uses the <PaperCode>--data-dir</PaperCode> it was installed with. See <PaperLink href="/docs/paperboard/run-as-service/#options">Run the daemon as a service</PaperLink>.
            </PaperText>
            <PaperText preset="body" as="p">
                When the desktop app starts, it looks for a server daemon already running for its data directory and uses it.
                Only when none is running does it start its own.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="whats-inside">What is inside</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Path</th>
                        <th>What it holds</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>panels/</PaperCode></td><td>The installed panels, one folder each.</td></tr>
                    <tr><td><PaperCode>configs/&lt;panel id&gt;.json</PaperCode></td><td>Each panel's settings.</td></tr>
                    <tr><td><PaperCode>files/&lt;panel id&gt;/</PaperCode></td><td>Each panel's files, such as a game server's worlds.</td></tr>
                    <tr><td><PaperCode>packages/</PaperCode></td><td>Programs that panels use, such as a Java runtime.</td></tr>
                    <tr><td><PaperCode>backups/</PaperCode></td><td>Panel backups kept on this computer, and the backup locations and schedules. See <PaperLink href="/docs/paperboard/backups/">Backups</PaperLink>.</td></tr>
                    <tr><td><PaperCode>logs/</PaperCode></td><td>Log files. <PaperCode>paperboard.log</PaperCode> is the main one.</td></tr>
                    <tr><td><PaperCode>sockets/</PaperCode></td><td>Connections to running programs, such as open terminals. Only your account can open it.</td></tr>
                    <tr><td><PaperCode>local/</PaperCode></td><td>This computer's private files, listed below. Only your account can open it.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="local">The local folder</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>local/</PaperCode> holds what belongs to this computer alone.
                On Linux and macOS, only your account can open the folder.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>File</th>
                        <th>What it holds</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>secrets.json</PaperCode></td><td>Passwords, keys and tokens that panels saved, and the sign-ins for backup locations. Plain JSON, not encrypted.</td></tr>
                    <tr><td><PaperCode>authorized_tokens.json</PaperCode></td><td>The tokens of the computers paired with this daemon.</td></tr>
                    <tr><td><PaperCode>tls_identity.json</PaperCode></td><td>The daemon's certificate and key. Paired computers trust this certificate.</td></tr>
                    <tr><td><PaperCode>crane.json</PaperCode></td><td>How programs on this computer reach the running daemon, with its token. Removed when the daemon stops.</td></tr>
                    <tr><td><PaperCode>process-owners.json</PaperCode></td><td>Which panel owns which running program.</td></tr>
                    <tr><td><PaperCode>machine-id.json</PaperCode></td><td>A random id the daemon announces on the local network.</td></tr>
                    <tr><td><PaperCode>paired_computers.json</PaperCode></td><td>The desktop app's list of computers it is paired with, with their tokens and certificates.</td></tr>
                    <tr><td><PaperCode>app-settings.json</PaperCode></td><td>The desktop app's settings: appearance, reduce motion, start page, run on startup.</td></tr>
                    <tr><td><PaperCode>panel-permissions.json</PaperCode></td><td>Your microphone, camera and screen answers for each panel.</td></tr>
                    <tr><td><PaperCode>last_update.json</PaperCode></td><td>When the last update check ran.</td></tr>
                    <tr><td><PaperCode>electron/</PaperCode></td><td>The desktop app's browser profile: caches, cookies and downloaded app updates.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>secrets.json</PaperCode>, <PaperCode>authorized_tokens.json</PaperCode>, <PaperCode>tls_identity.json</PaperCode>, <PaperCode>crane.json</PaperCode> and <PaperCode>process-owners.json</PaperCode> are also private files of their own, readable by your account only.
                These permissions apply on Linux and macOS. On a drive without file permissions, such as FAT, Paperboard cannot set them and logs a warning.
            </PaperText>
            <PaperText preset="body" as="p">
                Deleting <PaperCode>tls_identity.json</PaperCode> gives the daemon a new certificate on its next start, and every paired computer has to pair again.
                If the file is damaged, the daemon does not start and says so, instead of making a new one.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="logs">Logs</PaperText>
            <PaperText preset="body" as="p">
                Paperboard and the daemon write <PaperCode>logs/paperboard.log</PaperCode>. App updates are logged in <PaperCode>logs/electron-updater.log</PaperCode>.
                When a log reaches 5 MB, it moves to <PaperCode>paperboard.1.log</PaperCode>, the previous one moves to <PaperCode>paperboard.2.log</PaperCode>, and the oldest is deleted.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="copying-it">Copying it</PaperText>
            <PaperText preset="body" as="p">
                Stop Paperboard and the daemon before you copy or move the folder, so nothing is written while you copy.
                A copy contains your secrets and pairing tokens in plain files. Keep it as private as the computer.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/backups/">back up panels</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
