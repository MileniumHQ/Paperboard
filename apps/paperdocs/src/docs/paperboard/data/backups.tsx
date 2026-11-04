import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BackupsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Backups</PaperText>
            <PaperText preset="body" as="p">
                Panels back up their own files and settings to a location you choose: the computer itself, Google Drive, or an S3 bucket.
                The server daemon makes routine backups on a schedule, with Paperboard closed or open.
                A backup is a plain compressed archive, and it is not encrypted.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="what-a-backup-holds">What a backup holds</PaperText>
            <PaperText preset="body" as="p">
                A backup belongs to one panel on one computer. It holds:
            </PaperText>
            <PaperTextList>
                <li>The panel's files folder, <PaperCode>files/&lt;panel id&gt;/</PaperCode> in the data directory. For Game Server, that is every server's worlds, settings, plugins and mods.</li>
                <li>The panel's settings, <PaperCode>configs/&lt;panel id&gt;.json</PaperCode>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                It does not hold the panel's saved secrets, the panel's program, or shortcuts (symbolic links) inside its files.
                A panel can leave out parts of its own files, such as caches.
                A backup larger than 5 GiB is refused.
            </PaperText>
            <PaperText preset="body" as="p">
                Panels offer backups on their own pages. Game Server has a <b>Backups</b> page. A panel without one has no backups.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="locations">Backup locations</PaperText>
            <PaperText preset="body" as="p">
                Each computer has its own list of locations, on its Computer Info page under <b>Backups</b>.
                Open it by selecting the computer in the rail, then the top entry of its sidebar.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Location</th>
                        <th>Where backups go</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>The computer's own folder</td>
                        <td><PaperCode>backups/panels/&lt;panel id&gt;/</PaperCode> in its data directory. Listed under the computer's name. Always there, and cannot be removed.</td>
                    </tr>
                    <tr>
                        <td>Google Drive</td>
                        <td>A <b>Paperboard Backups</b> folder in your Drive. Paperboard can see only the files it made there, not your other files.</td>
                    </tr>
                    <tr>
                        <td>S3 bucket</td>
                        <td>A bucket on Amazon S3 or an S3-compatible server you run yourself, such as MinIO.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A backup on the computer's own folder is lost with that computer's drive. Use Google Drive or a bucket for a copy somewhere else.
            </PaperText>

            <PaperText preset="title" as="h3" id="add-a-location">Add a location</PaperText>
            <PaperTextList ordered>
                <li>On the computer's Computer Info page, under <b>Backups</b>, select <b>Add Location</b>.</li>
                <li>For Google Drive, choose it and select <b>Sign In With Google</b>. Finish signing in in your browser.</li>
                <li>For a bucket, choose <b>S3 bucket</b> and fill in <b>Name</b>, <b>Server address</b>, <b>Region</b>, <b>Bucket name</b>, <b>Access key ID</b> and <b>Secret access key</b>. <b>Folder (optional)</b> keeps backups under a folder in the bucket. Turn on <b>Self-hosted server</b> for MinIO and other servers you run yourself. Select <b>Add Bucket</b>, and Paperboard tests the connection before saving it.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The Google sign-in and the bucket's secret access key are kept in the computer's secret store, not in its settings.
                Each location shows how much space its backups take and how much is free.
                A computer holds up to 16 added locations.
            </PaperText>
            <PaperText preset="body" as="p">
                <b>Reconnect</b> on a Google Drive location signs in again. <b>Remove</b> takes a location off the list: panels using it stop making backups until you choose another location, and the backups already there are not deleted.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="make-a-backup">Make a backup</PaperText>
            <PaperText preset="body" as="p">
                In Game Server, open <b>Backups</b> and select <b>Back Up Now</b>.
                The first time, Paperboard asks <b>Where should backups go?</b>. Pick a location and select <b>Use this location</b>.
                Later backups of that panel go to the same place. Change it with <b>Change</b> next to <b>Kept in</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                While it copies, the panel holds its work so the copy is complete.
                A running Minecraft server keeps going and pauses saving during the copy. A running Terraria server is saved, stopped for the copy, and started again.
                The description under <b>Routine Backups</b> says which applies to a server.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="routine-backups">Routine backups</PaperText>
            <PaperText preset="body" as="p">
                Turn on <b>Routine Backups</b>. Then choose:
            </PaperText>
            <PaperTextList>
                <li><b>How Often</b>: every hour, 3 hours, 6 hours, 12 hours, every day, every 2 days, or every week. The default is every day.</li>
                <li><b>Keep</b>: how many routine backups to keep, from the newest 1 to the newest 30. The default is 7.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The server daemon makes them, so they happen with the Paperboard window closed, as long as the computer and its daemon are running.
                When a panel is busy at the scheduled time, the daemon tries again 15 minutes later.
                Older routine backups are deleted past the number you keep. Backups made with <b>Back Up Now</b> are never deleted for you.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="restore">Restore a backup</PaperText>
            <PaperTextList ordered>
                <li>In Game Server, open <b>Backups</b>. <b>Saved Backups</b> lists each backup with its date, its size, and whether it was routine or made by hand.</li>
                <li>Select <b>Restore</b> on the backup.</li>
                <li>Read the warning and select <b>Restore</b>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The server stops, and its whole folder is replaced with the backup. Anything saved since the backup was made is lost.
            </PaperText>
            <PaperText preset="body" as="p">
                Before it changes anything, the daemon downloads the backup and checks it against the checksum recorded when it was made.
                It refuses a backup made by a newer version of the panel: update the panel first.
                It swaps the panel's files and settings in one step, so a restore that fails leaves the old data as it was.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="the-files">The backup files</PaperText>
            <PaperText preset="body" as="p">
                Each backup is two files with the same name, made from the date and time in UTC and six random hexadecimal characters:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>File</th>
                        <th>What it is</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>20261104-135602-4f09ac.pbbackup</PaperCode></td>
                        <td>The archive: a gzip-compressed tar file, not encrypted. Its paths start at the data directory: <PaperCode>files/&lt;panel id&gt;/</PaperCode> and <PaperCode>configs/&lt;panel id&gt;.json</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>20261104-135602-4f09ac.json</PaperCode></td>
                        <td>The record: the panel id and version, when it was made, its size, its SHA-256 checksum, and its label (<PaperCode>Routine backup</PaperCode> for routine ones). On Google Drive, the record is kept in the archive's description.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Any tar tool opens the archive. To list it, or to take files out into a new folder without touching Paperboard, run these from the folder that holds it:
            </PaperText>
            <PaperCode block language="sh">
{`tar -tzf 20261104-135602-4f09ac.pbbackup
mkdir restored
tar -xzf 20261104-135602-4f09ac.pbbackup -C restored`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The first command lists every file in the backup. The other two unpack it into a new folder named <PaperCode>restored</PaperCode>.
                Anyone who can read a backup can read everything in it, so keep its location as private as the computer.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/security/">what Paperboard protects, and what it trusts</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
