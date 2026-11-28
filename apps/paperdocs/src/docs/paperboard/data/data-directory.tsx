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
                    <tr><td><PaperCode>backups/</PaperCode></td><td>Panel backups kept on this computer, and the backup locations. See <PaperLink href="/docs/paperboard/backups/">Backups</PaperLink>.</td></tr>
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
                    <tr><td><PaperCode>tls_identity.json</PaperCode></td><td>The daemon's certificate and key. Paired computers trust this certificate, and the computer list knows this computer by its key. A new key makes a new computer: its computer list starts over, and the old one is moved aside as <PaperCode>network.replaced-&lt;time&gt;</PaperCode>.</td></tr>
                    <tr><td><PaperCode>crane.json</PaperCode></td><td>How programs on this computer reach the running daemon, with its token. Removed when the daemon stops.</td></tr>
                    <tr><td><PaperCode>process-owners.json</PaperCode></td><td>Which panel owns which running program.</td></tr>
                    <tr><td><PaperCode>machine-id.json</PaperCode></td><td>A random id the daemon announces on the local network.</td></tr>
                    <tr><td><PaperCode>network/</PaperCode></td><td>The computer list, as signed and encrypted records: each computer's name and certificate, and what each computer says of itself (where it listens and what it runs), which only that computer can write. It also holds the network's key, sealed for each computer it was shared with. It holds no tokens and no order. A damaged file here stops the daemon from starting rather than being read as empty.</td></tr>
                    <tr><td><PaperCode>network_roster_private.json</PaperCode></td><td>This computer's own part of the list: its tokens for the computers it is paired with, the ids older versions of Paperboard gave them, the order you put them in here, and what it saw of the others from where it is: the address it reached each at (where it was paired, until the computer answers where it says it listens), each one's operating system as this computer was told it when pairing or signing in (until the computer says so itself), when it was last connected to each, and when it last took everything each one had.</td></tr>
                    <tr><td><PaperCode>active_computer.json</PaperCode></td><td>The computer the desktop app has selected.</td></tr>
                    <tr><td><PaperCode>app-settings.json</PaperCode></td><td>The desktop app's settings: appearance, animations, blur, start page, run on startup.</td></tr>
                    <tr><td><PaperCode>panel-permissions.json</PaperCode></td><td>Your microphone, camera and screen answers for each panel.</td></tr>
                    <tr><td><PaperCode>last_update.json</PaperCode></td><td>When the last update check ran.</td></tr>
                    <tr><td><PaperCode>electron/</PaperCode></td><td>The desktop app's browser profile: caches, cookies and downloaded app updates.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>secrets.json</PaperCode>, <PaperCode>authorized_tokens.json</PaperCode>, <PaperCode>tls_identity.json</PaperCode>, <PaperCode>network/</PaperCode>, <PaperCode>network_roster_private.json</PaperCode>, <PaperCode>crane.json</PaperCode> and <PaperCode>process-owners.json</PaperCode> are also kept private on their own, readable by your account only.
                These permissions apply on Linux and macOS. On a drive without file permissions, such as FAT, Paperboard cannot set them and logs a warning.
            </PaperText>
            <PaperText preset="body" as="p">
                Deleting <PaperCode>tls_identity.json</PaperCode> gives the daemon a new certificate on its next start, and every paired computer has to pair again. The computer list starts over with only this computer in it, and the old one is kept beside it as <PaperCode>network.replaced-…</PaperCode>.
                If the file is damaged, the daemon does not start and says so, instead of making a new one.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="one-server">One server per folder</PaperText>
            <PaperText preset="body" as="p">
                Only one server daemon uses a data folder at a time, including the one built into the desktop app.
                Before a daemon reads or writes anything in the folder, it claims the folder from the operating system.
                A second daemon that starts on the same folder, even at the same moment, stops, saying that another Paperboard server is already starting or running with the data folder, and changes nothing.
                The claim ends with the daemon however it stops, so a crash leaves nothing to clear.
            </PaperText>
            <PaperText preset="body" as="p">
                The only thing a daemon makes before it holds the claim is the data folder itself, empty, when it doesn't exist yet (with any missing folders above it). The claim keeps no file.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Computer</th>
                        <th>The claim</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>macOS</td><td>A lock on the data folder itself. A disk that can't hold the lock stops the daemon, which asks you to move the folder to a local disk.</td></tr>
                    <tr><td>Linux</td><td>Two names the system holds for the daemon: one made from the folder's disk and its number on that disk, and one made from the folder's path.</td></tr>
                    <tr><td>Windows</td><td>Two named pipes the system holds for the daemon: one made from the folder's volume and its number on that volume, and one made from the folder's path.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The claim belongs to the folder, not to how its path is written: the folder reached through a link, written in another case, or moved is the same folder.
                A copy is another folder, with a claim of its own (see <PaperLink href="#copying-it">Copying it</PaperLink>).
                On Linux and Windows, the path is claimed too: while a daemon runs, no second daemon starts on its path, even once the path leads to another folder.
            </PaperText>
            <PaperText preset="body" as="p" id="moved-while-running">
                A running daemon doesn't follow its folder. If the folder is moved, deleted or replaced while the daemon runs (or a link in its path is pointed at another folder), the daemon stops, saying that the data folder was moved, deleted or replaced while Paperboard was running.
                It writes nothing more at the path, so the folder that is there now gets none of its changes, and changes it hadn't saved yet are lost; the moved folder keeps everything saved before.
                It checks before each save of its own state and of the computer list, and once a second: a panel's own files written in that second can still land at the path.
                Start Paperboard again to use the folder that is at the path now.
            </PaperText>
            <PaperText preset="body" as="p">
                On Linux and Windows, another program on this computer, under any account, could take the folder's or the path's name first. Then no daemon starts on the folder until that program stops, and the error names which one is held.
            </PaperText>
            <PaperText preset="body" as="p">
                What the claim can't stop:
            </PaperText>
            <PaperTextList>
                <li>A data folder on a network share is claimed on this computer only, so a daemon on another computer that uses the same share isn't stopped. Use the folder from one computer at a time. The daemon warns about this when it starts on a share it recognizes: on Linux, NFS, SMB, 9P, Ceph, AFS, GlusterFS, and shares mounted with sshfs, rclone, GNOME's gvfs or davfs; on Windows, a folder whose path is a network path such as <PaperCode>\\server\share</PaperCode>. It doesn't recognize other kinds of share.</li>
                <li>On Linux, daemons in containers that each have a network of their own don't see each other's claim. A daemon can't tell that from inside a container (Toolbox and Distrobox share the computer's network, Docker and Podman usually don't), so it doesn't warn about it. Give each container its own data folder.</li>
                <li>On macOS the claim is the folder's alone: once the path leads to another folder, a second daemon can start there while the first still runs. The first stops before it writes there again.</li>
                <li>A daemon of Paperboard 0.4 or before takes no claim. Either one still finds the other once it is running, through <PaperCode>local/crane.json</PaperCode>, and won't start beside it. Only an older and a newer daemon that start at the same moment aren't stopped.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="logs">Logs</PaperText>
            <PaperText preset="body" as="p">
                Paperboard and the daemon write <PaperCode>logs/paperboard.log</PaperCode>. App updates are logged in <PaperCode>logs/electron-updater.log</PaperCode>.
                When a log reaches 5 MB, it moves to <PaperCode>paperboard.1.log</PaperCode>, the previous one moves to <PaperCode>paperboard.2.log</PaperCode>, and the oldest is deleted.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="copying-it">Copying it</PaperText>
            <PaperText preset="body" as="p">
                Stop Paperboard and the daemon before you copy or move the folder, so nothing is written while you copy. A daemon running while its folder is moved stops (see <PaperLink href="#moved-while-running">above</PaperLink>).
                A copy contains your secrets and pairing tokens in plain files. Keep it as private as the computer.
            </PaperText>
            <PaperText preset="body" as="p">
                A copy is another folder to the claim, so a daemon can start on it while the original runs. It has the same key as the original, so other computers take it for the same computer: don't run both.
                A copy made while the daemon runs can hold files from different moments, which no crash leaves behind, so the copy can miss changes for good. Copy a folder only while its daemon is stopped.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/backups/">back up panels</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
