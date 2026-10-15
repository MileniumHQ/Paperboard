import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function BackupsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Backups API</PaperText>
            <PaperText preset="body">
                backupApi makes, lists, restores, and deletes backups of a panel's data.
                A backup holds the panel's file storage and its config document. Vault secrets are not part of a backup.
                The user decides where a panel's backups go: a folder on the computer the panel runs on, an S3-compatible bucket, or Google Drive.
                A location's <PaperCode>label</PaperCode> names it for people. The computer's own folder is labelled with the name Paperboard shows for that computer, such as "This Computer".
                Reach for backupApi to give users a way back after a bad edit, a migration, or a move.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import backupApi from @mileniumhq/paperapi. Every call names the panel explicitly.
                A panel has no backup location until the user chooses one, so check the status first and open the location window from a click when it is missing.
            </PaperText>
            <PaperCode block language="tsx">
{`import { backupApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.panel";

// call from a click handler: chooseLocation opens a window
async function backUp() {
    const status = await backupApi.status(PANEL_ID);
    if (!status.location) {
        const choice = await backupApi.chooseLocation(PANEL_ID);
        if (choice.status === "canceled") return;
    }
    await backupApi.create(PANEL_ID, { label: "Label" });
}

async function restoreNewest() {
    const [newest] = await backupApi.list(PANEL_ID);
    if (newest) await backupApi.restore(PANEL_ID, newest.id);
}`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
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
                        <td><PaperCode>status</PaperCode></td>
                        <td><PaperCode>status(appId): Promise&lt;BackupStatus&gt;</PaperCode></td>
                        <td>The panel's backup location, or null when none is chosen, the backup job running for the panel, if any, and its routine backup schedule, or null.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>chooseLocation</PaperCode></td>
                        <td><PaperCode>chooseLocation(appId): Promise&lt;ChooseBackupLocationResult&gt;</PaperCode></td>
                        <td>Opens Paperboard's backup location window for the panel. Resolves with the chosen location or a cancel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>create</PaperCode></td>
                        <td><PaperCode>create(appId, options?): Promise&lt;BackupRecord&gt;</PaperCode></td>
                        <td>Backs up the panel now. <PaperCode>options.label</PaperCode> names the backup, at most 100 characters.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>list(appId): Promise&lt;BackupRecord[]&gt;</PaperCode></td>
                        <td>The panel's backups at its location, newest first, at most 500.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>restore</PaperCode></td>
                        <td><PaperCode>restore(appId, backupId): Promise&lt;BackupRecord&gt;</PaperCode></td>
                        <td>Replaces the panel's file storage and config document with the backup's.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>delete</PaperCode></td>
                        <td><PaperCode>delete(appId, backupId): Promise&lt;void&gt;</PaperCode></td>
                        <td>Deletes the backup from the panel's location.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setSchedule</PaperCode></td>
                        <td><PaperCode>setSchedule(appId, schedule | null): Promise&lt;BackupStatus&gt;</PaperCode></td>
                        <td>Turns routine backups on or changes them with <PaperCode>{"{ everyHours, keep }"}</PaperCode>, or turns them off with null. See Routine backups.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="backup-records">Backup records</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Pass it to restore and delete. Ids sort by creation time.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>createdAt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>ISO timestamp of the backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>Bytes of the compressed backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sha256</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Hex digest of the backup's bytes. A restore checks the downloaded bytes against it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>panelVersion</PaperCode></td>
                        <td><PaperCode>string | null</PaperCode></td>
                        <td>The installed panel version that made the backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string | null</PaperCode></td>
                        <td>The label passed to create, or null. Routine backups carry <PaperCode>ROUTINE_BACKUP_LABEL</PaperCode> ("Routine backup"), which create refuses.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="choosing-a-location">Choosing a location</PaperText>
            <PaperText preset="body">
                chooseLocation shows the computer's backup locations with the space each one uses and has free. The user picks one, and the panel's later backups go there.
                A panel cannot set its location itself. Call chooseLocation from a click handler in the panel page; a widget gets a BackupLocationError with code <PaperCode>unavailable</PaperCode>.
                The user adds S3 buckets and Google Drive on the computer's Computer Info page. Google Drive is connected by signing in to Google from the Paperboard app, and Paperboard sees only the "Paperboard Backups" folder it creates.
                Changing a panel's location does not move its existing backups. list shows the backups at the current location.
            </PaperText>

            <PaperText preset="subheader" id="routine-backups">Routine backups</PaperText>
            <PaperText preset="body">
                The computer's Paperboard Server makes routine backups on a schedule, whether the Paperboard app is open or not. A panel turns them on with setSchedule once it has a backup location.
                <PaperCode>everyHours</PaperCode> is one of <PaperCode>ROUTINE_BACKUP_HOURS</PaperCode> (1, 3, 6, 12, 24, 48 or 168). <PaperCode>keep</PaperCode> is 1 to 100.
                The first routine backup runs one interval after the schedule is set. Changing only keep leaves the next one when it was.
                After each routine backup, the routine backups beyond the newest <PaperCode>keep</PaperCode> are deleted. Backups made with create are never deleted by a schedule.
                The schedule's <PaperCode>last</PaperCode> says when the last routine backup finished, whether it worked, and why not. One that failed is tried again 15 minutes later.
                Routine backups run one panel at a time. Uninstalling a panel and deleting its data removes its schedule; uninstalling it and keeping its data keeps the schedule for a reinstall.
            </PaperText>

            <PaperText preset="subheader" id="errors">Errors</PaperText>
            <PaperText preset="body">
                create, list, restore, and delete throw when they fail. The thrown error carries a <PaperCode>code</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>CONFLICT</PaperCode></td>
                        <td>No location is chosen, a backup or restore is already running for the panel, two backup jobs are running on the computer, another operation such as an update holds the panel, or the backup was made by a newer panel version than the one installed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>NOT_FOUND</PaperCode></td>
                        <td>The backup id is not at the panel's location.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>FORBIDDEN</PaperCode></td>
                        <td>The appId names another panel than the caller's.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>INVALID_PARAMS</PaperCode></td>
                        <td>A label or schedule is not one create or setSchedule accepts.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>INTERNAL</PaperCode></td>
                        <td>The location refused or could not be reached, the downloaded bytes do not match the record, or the panel did not become ready on the restored data. The message says which.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                create stops the panel's service while it copies the data, so the copy is not taken mid-write. The service starts again and create waits for it to be ready before it uploads.
                restore refuses a backup that holds anything other than this panel's file storage and config document, and refuses links.
                restore stops the service and the processes the panel started, then swaps the data in. When the service does not become ready on the restored data, the previous data goes back in place and the service restarts on it.
                A service defined with a <PaperCode>beforeBackup</PaperCode> hook (see definePanelService) is asked first, while it still runs, so it can write out what it holds and stop processes it runs from writing. When the hook throws, create fails with CONFLICT and the service is still stopped and started again.
                A service that was stopped before a backup or restore stays stopped.
                create and restore have no call timeout. They take as long as the bytes take to copy.
            </PaperText>
        </PaperFlex>
    );
}
