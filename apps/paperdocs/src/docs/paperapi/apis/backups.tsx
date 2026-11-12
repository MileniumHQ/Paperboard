import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BackupsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">backupApi</PaperText>
            <PaperText preset="body" as="p">
                backupApi makes, lists and restores backups of a panel's files and config, and turns routine backups on.
                It works on a panel page, in a widget and in a service, except <PaperCode>chooseLocation</PaperCode>, which opens a window and works only on a panel page.
                The daemon makes every backup, so routine backups run with Paperboard closed.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { backupApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

const status = await backupApi.status(PANEL_ID);
if (!status.location) {
    const chosen = await backupApi.chooseLocation(PANEL_ID);
    if (chosen.status === "canceled") return;
}
const record = await backupApi.create(PANEL_ID, { label: "Before the city import" });
await backupApi.setSchedule(PANEL_ID, { everyHours: 24, keep: 7 });`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`backupApi.status(appId: string, scope?: string): Promise<BackupStatus>;
backupApi.chooseLocation(appId: string, sourceId?: string): Promise<ChooseBackupLocationResult>;
backupApi.create(appId: string, options?: { label?: string }, scope?: string): Promise<BackupRecord>;
/** newest first */
backupApi.list(appId: string, scope?: string): Promise<BackupRecord[]>;
backupApi.restore(appId: string, backupId: string, scope?: string): Promise<BackupRecord>;
backupApi.delete(appId: string, backupId: string, scope?: string): Promise<void>;
/** null turns routine backups off */
backupApi.setSchedule(
    appId: string,
    schedule: { everyHours: 1 | 3 | 6 | 12 | 24 | 48 | 168; keep: number } | null,
    scope?: string,
): Promise<BackupStatus>;

/** every backup or restore running for the panel's data, its sources included */
backupApi.progress(appId: string, scope?: string): Promise<BackupProgress[]>;
/** returns the unsubscribe */
backupApi.onProgress(appId: string, listener: (change: BackupProgressChange) => void, scope?: string): () => void;
/** 0 to 1; null when the step can't be measured */
backupProgressFraction(progress: BackupProgress): number | null;
/** "Compressing 42%", or "Getting ready…" */
backupProgressText(progress: BackupProgress): string;

backupApi.defineSource(appId: string, source: BackupSource, scope?: string): Promise<void>;
backupApi.forSource(appId: string, sourceId: string, scope?: string): BackupSourceHandle;`}
            </PaperCode>
            <PaperCode block language="tsx">
{`interface BackupStatus {
    /** null until the person chooses where the panel's backups go */
    location: BackupLocation | null;
    /** a backup being made or restored for the panel right now */
    running: "create" | "restore" | null;
    /** how far along it is; null when none is running */
    progress: BackupProgress | null;
    /** null without routine backups */
    schedule: BackupSchedule | null;
}

interface BackupLocation {
    id: string;
    kind: "local" | "s3" | "gdrive";
    /** a local location shows the computer's name */
    label: string;
    /** where it is, for people: a folder, a bucket, an account */
    detail: string;
    /** false for the computer's own folder, which is built in */
    removable: boolean;
}

type ChooseBackupLocationResult = { status: "chosen"; location: BackupLocation } | { status: "canceled" };

interface BackupRecord {
    format: 1;
    /** sorts by creation time */
    id: string;
    panelId: string;
    /** set on a source's backups */
    sourceId?: string;
    /** ISO time */
    createdAt: string;
    /** archive bytes */
    size: number;
    /** the archive's sha256, in hex */
    sha256: string;
    /** the panel version that made it */
    panelVersion: string | null;
    label: string | null;
}

interface BackupProgress {
    panelId: string;
    /** null for the panel's own backups */
    sourceId: string | null;
    kind: "create" | "restore";
    step: "preparing" | "copying" | "packing" | "saving" | "downloading" | "checking" | "unpacking" | "restoring";
    /** bytes done and expected in this step; null when it can't be measured */
    done: number | null;
    total: number | null;
    /** true while the step holds the panel's service stopped */
    servicePaused: boolean;
}

/** progress is null once the backup or restore ends */
interface BackupProgressChange {
    panelId: string;
    sourceId: string | null;
    progress: BackupProgress | null;
}

interface BackupSchedule {
    everyHours: 1 | 3 | 6 | 12 | 24 | 48 | 168;
    /** how many routine backups stay; older routine backups are deleted */
    keep: number;
    /** ISO time the next one is due */
    nextRunAt: string;
    last: { at: string; ok: boolean; message: string | null } | null;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="locations">Locations</PaperText>
            <PaperTextList>
                <li>A panel has no location until the person picks one. <PaperCode>chooseLocation</PaperCode> opens Paperboard's backup location window, where the person picks the computer's own folder, an S3 bucket or a Google Drive, or adds one.</li>
                <li>A panel can't pick, add or read locations itself: those calls belong to Paperboard and are refused to panels.</li>
                <li>Making, listing, restoring and deleting backups, and routine backups, fail until a location is chosen. Check <PaperCode>status().location</PaperCode> first, as the sample does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="making-and-restoring">Making and restoring</PaperText>
            <PaperTextList>
                <li>A backup is one archive of the panel's <PaperLink href="/docs/paperapi/file/">files folder</PaperLink> and its <PaperLink href="/docs/paperapi/config/">config</PaperLink> documents. Secrets are never included.</li>
                <li>The daemon stops the panel's service while it copies, then starts it again. A service with a <PaperLink href="/docs/paperapi/service/">beforeBackup</PaperLink> hook gets ready first, and one with <PaperCode>afterBackup</PaperCode> hears how it ended.</li>
                <li>A backup or restore that a service starts from inside one of its own calls or blocks stops that service before it can answer. Paperboard answers the call with the record, or the error, so return the record as it is: code after the call doesn't run.</li>
                <li>A restore downloads the archive, checks its size and sha256 against the record, stops the service, replaces the files and config, and starts the service again.</li>
                <li>A backup made by a newer version of the panel than the one installed is refused, so old code never reads new data.</li>
                <li>One backup or restore runs for each panel at a time, and two on the computer.</li>
                <li><PaperCode>label</PaperCode> is at most 100 characters. <PaperCode>Routine backup</PaperCode> is kept for routine backups.</li>
                <li>The calls have no timeout. Show <PaperCode>onProgress</PaperCode> to say how far along a backup is, as the sample below does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="progress">Progress</PaperText>
            <PaperText preset="body" as="p">
                A backup goes through <PaperCode>preparing</PaperCode>, <PaperCode>copying</PaperCode> (sources only), <PaperCode>packing</PaperCode> and <PaperCode>saving</PaperCode>.
                A restore goes through <PaperCode>downloading</PaperCode>, <PaperCode>checking</PaperCode>, <PaperCode>unpacking</PaperCode>, <PaperCode>preparing</PaperCode> and <PaperCode>restoring</PaperCode>.
                Copying, packing, saving and downloading count bytes. The others have <PaperCode>done</PaperCode> and <PaperCode>total</PaperCode> set to <PaperCode>null</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`const [progress, setProgress] = createSignal<BackupProgress | null>(null);
onCleanup(backupApi.onProgress(PANEL_ID, (change) => setProgress(change.progress)));

<PaperButton disabled={progress() !== null}>
    {progress() ? backupProgressText(progress()!) : "Back Up Now"}
</PaperButton>`}
            </PaperCode>
            <PaperTextList>
                <li>A new step arrives at once. Byte counts arrive at most every 250 ms.</li>
                <li>While <PaperCode>servicePaused</PaperCode> is true, the panel's service is stopped. Paperboard covers the panel page with the step and a progress bar, and reloads the page afterward if it lost its service.</li>
                <li>A routine backup reports progress too, so a page opened in the middle of one can read <PaperCode>status().progress</PaperCode> and listen for the rest.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="routine-backups">Routine backups</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>setSchedule</PaperCode> turns routine backups on, changes them, or turns them off with <PaperCode>null</PaperCode>.
                The first runs one interval from now, and changing only <PaperCode>keep</PaperCode> leaves the next one when it was.
                Routine backups beyond the newest <PaperCode>keep</PaperCode>, at most 100, are deleted. Backups made with <PaperCode>create</PaperCode> are never deleted by a schedule.
                The computer runs routine backups for at most 64 panels.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="sources">Sources</PaperText>
            <PaperText preset="body" as="p">
                A source is a named part of a panel's data with its own backups, location and schedule, such as one game server among several.
                Define it from the service each time it starts, then use its handle.
            </PaperText>
            <PaperCode block language="tsx">
{`interface BackupSource {
    /** a letter or digit, then letters, digits, ".", "_" and "-"; at most 64 */
    id: string;
    /** a folder in the panel's files folder; "" for all of it */
    directory: string;
    /** the part of the panel's main config document: keys, or { id } for the array entry with that id */
    config: Array<string | { id: string }>;
    /** process ids to stop before a restore; the panel's own */
    processes: string[];
    /** top-level names in directory left out of backups and kept on restore */
    exclude?: string[];
    /** file names left out wherever they are, such as a lock a running program holds */
    skip?: string[];
    /** this source keeps the panel's whole-panel backups, location and schedule */
    legacy?: boolean;
}

interface BackupSourceHandle {
    status(): Promise<BackupStatus>;
    list(): Promise<BackupRecord[]>;
    create(options?: { label?: string }): Promise<BackupRecord>;
    restore(backupId: string): Promise<BackupRecord>;
    delete(backupId: string): Promise<void>;
    setSchedule(schedule: { everyHours: 1 | 3 | 6 | 12 | 24 | 48 | 168; keep: number } | null): Promise<BackupStatus>;
    chooseLocation(): Promise<ChooseBackupLocationResult>;
    /** hears this source's backups and restores only */
    onProgress(listener: (change: BackupProgressChange) => void): () => void;
}`}
            </PaperCode>
            <PaperCode block language="tsx">
{`await backupApi.defineSource(PANEL_ID, {
    id: "lisbon",
    directory: "stations/lisbon",
    config: ["stations", { id: "lisbon" }],
    processes: ["station-lisbon"],
    skip: ["session.lock"],
});
const lisbon = backupApi.forSource(PANEL_ID, "lisbon");
await lisbon.create({ label: "Before the sensor swap" });`}
            </PaperCode>
            <PaperTextList>
                <li>A source's config selector must point at a value that exists, such as <PaperCode>config.stations</PaperCode>'s entry whose <PaperCode>id</PaperCode> is <PaperCode>lisbon</PaperCode>. A backup copies only that value, and a restore puts it back in place.</li>
                <li>A source restore stops only the source's <PaperCode>processes</PaperCode> and replaces only its folder and config value, with the service stopped. When the service does not start again afterward, the old data is put back.</li>
                <li>Defining a source again with the same id must give the same <PaperCode>directory</PaperCode>, <PaperCode>config</PaperCode>, <PaperCode>processes</PaperCode>, <PaperCode>exclude</PaperCode> and <PaperCode>legacy</PaperCode>. Only <PaperCode>skip</PaperCode> may change.</li>
                <li>Links inside the folder are left out of a source backup.</li>
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
                    <tr><td><PaperCode>No backup location chosen for this panel</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td><PaperCode>create</PaperCode>, <PaperCode>list</PaperCode> or <PaperCode>restore</PaperCode> before a location is chosen.</td></tr>
                    <tr><td><PaperCode>Choose where this panel's backups are kept first</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td><PaperCode>setSchedule</PaperCode> before a location is chosen.</td></tr>
                    <tr><td><PaperCode>A backup is being made for this panel</PaperCode>, <PaperCode>... is being restored ...</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>One is already running for the panel.</td></tr>
                    <tr><td><PaperCode>Paperboard is busy with other backups. Try again when they finish</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>Two are running on the computer.</td></tr>
                    <tr><td><PaperCode>The panel could not get ready for a backup: &lt;message&gt;</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>The service's <PaperCode>beforeBackup</PaperCode> threw.</td></tr>
                    <tr><td><PaperCode>This backup was made by version &lt;a&gt; of the panel; &lt;b&gt; is installed. Update the panel first</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>A restore of a newer panel's backup.</td></tr>
                    <tr><td><PaperCode>Backup &lt;id&gt; is not at this panel's backup location</PaperCode></td><td><PaperCode>NOT_FOUND</PaperCode></td><td>A wrong id, or a backup at another location.</td></tr>
                    <tr><td><PaperCode>The downloaded backup does not match its record; it was not restored</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The archive was changed or damaged.</td></tr>
                    <tr><td><PaperCode>"Routine backup" is kept for routine backups</PaperCode>, <PaperCode>label must be at most 100 characters</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A reserved or long label.</td></tr>
                    <tr><td><PaperCode>everyHours must be one of 1, 3, 6, 12, 24, 48, 168</PaperCode>, <PaperCode>keep must be a whole number from 1 to 100</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A schedule outside the choices.</td></tr>
                    <tr><td><PaperCode>Invalid backup source</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A source outside the rules above.</td></tr>
                    <tr><td><PaperCode>A backup source cannot change its files or config selector</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A source defined again with other values.</td></tr>
                    <tr><td><PaperCode>The backup source's config no longer exists</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The config selector points at nothing.</td></tr>
                    <tr><td><PaperCode>A backup source cannot stop another panel's process</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A <PaperCode>processes</PaperCode> id another panel owns.</td></tr>
                    <tr><td><PaperCode>Choose an explicit backup source id</PaperCode></td><td>No code</td><td><PaperCode>forSource</PaperCode> with an id outside the rule. Thrown before anything is sent.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>chooseLocation</PaperCode> rejects with a <PaperCode>BackupLocationError</PaperCode> whose <PaperCode>code</PaperCode> is <PaperCode>unavailable</PaperCode> (<PaperCode>Choosing a backup location needs a panel shown in Paperboard</PaperCode>, or <PaperCode>A widget cannot choose a backup location; open its panel instead</PaperCode>), <PaperCode>busy</PaperCode> (<PaperCode>The backup location window is already open</PaperCode>) or <PaperCode>failed</PaperCode>.
                The limits are exported as <PaperCode>ROUTINE_BACKUP_HOURS</PaperCode>, <PaperCode>MAX_ROUTINE_BACKUPS_KEPT</PaperCode> and <PaperCode>ROUTINE_BACKUP_LABEL</PaperCode>.
            </PaperText>
        </PaperFlex>
    );
}
