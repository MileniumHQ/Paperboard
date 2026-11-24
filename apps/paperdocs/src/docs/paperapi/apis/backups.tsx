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
                backupApi makes, lists and restores backups of a panel's files, plus a little JSON the panel hands over.
                It works on a panel page, in a widget and in a service, except <PaperCode>chooseLocation</PaperCode>, which opens a window and works only on a panel page.
                The panel's service decides what a backup holds, and keeps running the whole time. Routine backups are the panel's own job.
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
const record = await backupApi.create(PANEL_ID, { label: "Before the city import" });`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`backupApi.status(appId: string, options?: { target?: string }, scope?: string): Promise<BackupStatus>;
backupApi.chooseLocation(appId: string): Promise<ChooseBackupLocationResult>;
backupApi.create(appId: string, options?: { target?: string; label?: string }, scope?: string): Promise<BackupRecord>;
/** newest first */
backupApi.list(appId: string, options?: { target?: string }, scope?: string): Promise<BackupRecord[]>;
backupApi.restore(appId: string, backupId: string, options?: { target?: string }, scope?: string): Promise<BackupRecord>;
backupApi.delete(appId: string, backupId: string, options?: { target?: string }, scope?: string): Promise<void>;

/** every backup or restore running for the panel, of any target */
backupApi.progress(appId: string, scope?: string): Promise<BackupProgress[]>;
/** returns the unsubscribe; onLost hears why progress can't be heard, and null once it can again */
backupApi.onProgress(
    appId: string,
    listener: (change: BackupProgressChange) => void,
    options?: { onLost?: (why: string | null) => void; scope?: string },
): () => void;
/** 0 to 1; null when the step can't be measured */
backupProgressFraction(progress: BackupProgress): number | null;
/** "Compressing 42%", or "Getting ready…" */
backupProgressText(progress: BackupProgress): string;`}
            </PaperCode>
            <PaperCode block language="tsx">
{`interface BackupStatus {
    /** null until the person chooses where the panel's backups go */
    location: BackupLocation | null;
    /** the backup or restore of this target running now; null when none is */
    progress: BackupProgress | null;
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
    format: 2;
    /** sorts by creation time */
    id: string;
    panelId: string;
    /** what of the panel it backs up, as the panel names it; null for the panel as a whole */
    target: string | null;
    /** ISO time */
    createdAt: string;
    /** archive bytes */
    size: number;
    /** the archive's sha256, in hex */
    sha256: string;
    /** the panel version that made it */
    panelVersion: string | null;
    label: string | null;
    /** the files and folders of the panel's files folder it holds; "" is all of it */
    paths: string[];
    /** paths under those that were left out, and that a restore leaves as they are */
    exclude: string[];
}

interface BackupProgress {
    panelId: string;
    /** as in BackupRecord */
    target: string | null;
    kind: "create" | "restore";
    step: "preparing" | "packing" | "resuming" | "saving" | "downloading" | "checking" | "unpacking" | "restoring";
    /** bytes done and expected in this step; null when it can't be measured */
    done: number | null;
    total: number | null;
}

/** progress is null once the backup or restore ends */
interface BackupProgressChange {
    panelId: string;
    target: string | null;
    progress: BackupProgress | null;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="locations">Locations</PaperText>
            <PaperTextList>
                <li>A panel has one backup location, and none until the person picks one. <PaperCode>chooseLocation</PaperCode> opens Paperboard's backup location window, where the person picks the computer's own folder, an S3 bucket or a Google Drive, or adds one.</li>
                <li>A panel can't pick, add or read locations itself: those calls belong to Paperboard and are refused to panels.</li>
                <li>Making, listing, restoring and deleting backups fail until a location is chosen. Check <PaperCode>status().location</PaperCode> first, as the sample does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="targets">Targets</PaperText>
            <PaperText preset="body" as="p">
                A target is the panel's own name for a part of its data with backups of its own, such as one game server among several.
                Leave <PaperCode>target</PaperCode> out for a backup of the panel as a whole. A target is a letter or digit, then letters, digits, <PaperCode>.</PaperCode>, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>, at most 64 characters.
                Paperboard attaches no meaning to it: the panel's service hears it in every hook and decides which files it means. A target's backups are listed and restored apart from the panel's and from other targets', but all of them go to the panel's one location.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="making-and-restoring">Making and restoring</PaperText>
            <PaperText preset="body" as="p">
                Nothing stops the panel's service for a backup or restore. A backup runs in five steps, and the service takes part in the second and the fourth through its hooks:
            </PaperText>
            <PaperTextList>
                <li>A backup is started from anywhere: the panel's page, Blocks, or its service.</li>
                <li><PaperCode>beforeBackup</PaperCode> asks the service to stop what would write over the copy, and to name the files to keep.</li>
                <li>The files it names are copied as they are, without interrupting anything else.</li>
                <li><PaperCode>afterBackup</PaperCode> tells the service the copy is done, and it carries on.</li>
                <li>The copy is uploaded to the location.</li>
            </PaperTextList>
            <PaperTextList>
                <li>A backup is one archive of the paths the service names in its <PaperLink href="/docs/paperapi/file/">files folder</PaperLink>, and the JSON it hands over. Secrets are never included.</li>
                <li>A restore downloads the archive, checks its size and sha256 against the record, calls <PaperCode>beforeRestore</PaperCode>, replaces the paths with the backup's, and calls <PaperCode>afterRestore</PaperCode> with the JSON back. When that throws, the original files are put back and <PaperCode>afterRestore</PaperCode> is called again, to say so.</li>
                <li>Paperboard never touches a <PaperLink href="/docs/paperapi/config/">config</PaperLink> document. A panel that keeps its settings there hands them over as <PaperCode>data</PaperCode>, and writes them back in <PaperCode>afterRestore</PaperCode>.</li>
                <li>A panel whose service is not running, or has no <PaperCode>beforeBackup</PaperCode>, can't be backed up; one without <PaperCode>afterRestore</PaperCode> can't restore its backups.</li>
                <li>A backup made by a newer version of the panel than the one installed is refused, so old code never reads new data.</li>
                <li>The backups and restores of one panel run one after another: one for another target waits its turn. A second one for a target that already has one running is refused.</li>
                <li><PaperCode>label</PaperCode> is at most 100 characters.</li>
                <li>A backup started from inside one of the service's own calls or blocks just awaits <PaperCode>backupApi.create</PaperCode>: the service keeps running, so the call returns the record as any other.</li>
                <li>The calls have no timeout. Show <PaperCode>onProgress</PaperCode> to say how far along a backup is, as the sample below does.</li>
                <li>Backups made before this format are not recognised: they are not listed, and nothing migrates or deletes them.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="hooks">Hooks</PaperText>
            <PaperText preset="body" as="p">
                The hooks are options of <PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink>. Each hears the <PaperCode>target</PaperCode> (null for the panel as a whole).
            </PaperText>
            <PaperCode block language="tsx">
{`interface BackupContents {
    /** files and folders in the panel's files folder, "/" between names; "" is all of it.
     * None may repeat or hold another. May be empty when data is all there is to keep. */
    paths: string[];
    /** paths strictly under one of paths to leave out, none inside another; a restore leaves them as they are */
    exclude?: string[];
    /** file names left out wherever they are, such as a lock a running program holds */
    skip?: string[];
    /** JSON the panel gets back in afterRestore */
    data?: unknown;
}

definePanelService({
    contract,
    calls,
    beforeBackup: async (ctx, { target }) => {
        await saveEverything();
        return { paths: ["stations"], data: await config.get(PANEL_ID) };
    },
    afterBackup: async (ctx, copied) => {
        // copied.ok is false when the copy failed, with copied.error: carry on either way
        resumeWriting();
    },
    afterRestore: async (ctx, ended) => {
        if (!ended.ok) return resumeWriting();
        await config.set(ended.data, PANEL_ID);
        await reloadFromFiles();
    },
});`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Hook</th>
                        <th>Must do</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>beforeBackup</PaperCode></td>
                        <td>Required for the panel to be backed up. Stop what would write over the copy (a game server saves and stops saving), then return the <PaperCode>BackupContents</PaperCode>. Throwing refuses the backup: undo what you began first.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>afterBackup</PaperCode></td>
                        <td>Optional. The copy is done or failed, with <PaperCode>{"{ target, ok, error? }"}</PaperCode>: carry on (turn saving back on, start again). The upload happens after it resolves, and throwing fails the backup.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>beforeRestore</PaperCode></td>
                        <td>Optional. Stop what uses the files, with <PaperCode>{"{ target, backup }"}</PaperCode>. Throwing refuses the restore: undo what you began first.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>afterRestore</PaperCode></td>
                        <td>Required for the panel to restore. On <PaperCode>{"{ ok: true, data }"}</PaperCode> the files are the backup's: apply <PaperCode>data</PaperCode>, pick up from the files, and resume. When it throws, the original files are put back and it is called again with <PaperCode>{"{ ok: false, error }"}</PaperCode>, where the files are as they were: resume.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li><PaperCode>paths</PaperCode> and <PaperCode>exclude</PaperCode> each name at most 64 paths, and the record that lists them may not grow past 8 KiB. Name a few larger folders over many files.</li>
                <li><PaperCode>paths</PaperCode> may not repeat, and none may be inside another. Each <PaperCode>exclude</PaperCode> entry may not be <PaperCode>""</PaperCode>, must be strictly under one of the <PaperCode>paths</PaperCode>, and may not be inside another <PaperCode>exclude</PaperCode> entry.</li>
                <li>A restore of <PaperCode>""</PaperCode> swaps the storage's top-level entries one by one, so an excluded folder never moves.</li>
                <li>A backup must hold something: <PaperCode>paths</PaperCode> or <PaperCode>data</PaperCode>.</li>
                <li>Links inside a folder are left out.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="progress">Progress</PaperText>
            <PaperText preset="body" as="p">
                A backup goes through <PaperCode>preparing</PaperCode> (<PaperCode>beforeBackup</PaperCode>), <PaperCode>packing</PaperCode>, <PaperCode>resuming</PaperCode> (<PaperCode>afterBackup</PaperCode>) and <PaperCode>saving</PaperCode>.
                A restore goes through <PaperCode>downloading</PaperCode>, <PaperCode>checking</PaperCode>, <PaperCode>unpacking</PaperCode>, <PaperCode>preparing</PaperCode>, <PaperCode>restoring</PaperCode> and <PaperCode>resuming</PaperCode> (<PaperCode>afterRestore</PaperCode>, which runs while it is shown).
                Packing, saving and downloading count bytes. The others have <PaperCode>done</PaperCode> and <PaperCode>total</PaperCode> set to <PaperCode>null</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`const [progress, setProgress] = createSignal<BackupProgress | null>(null);
const [lost, setLost] = createSignal<string | null>(null);
onCleanup(backupApi.onProgress(PANEL_ID, (change) => setProgress(change.progress), {
    onLost: (why) => {
        setLost(why);
        // a backup that ended while it was lost is read again
        if (why === null) void backupApi.status(PANEL_ID).then((now) => setProgress(now.progress));
    },
}));

<Show when={lost()}>
    {(why) => <PaperError title="Couldn't follow backups" error={\`\${why()}. Paperboard keeps trying.\`} />}
</Show>
<PaperButton disabled={progress() !== null}>
    {progress() ? backupProgressText(progress()!) : "Back Up Now"}
</PaperButton>`}
            </PaperCode>
            <PaperTextList>
                <li>A new step arrives at once. Byte counts arrive at most every 250 ms.</li>
                <li>The panel keeps running, so Paperboard shows nothing over the page: a panel that wants to say a backup is running reads <PaperCode>status().progress</PaperCode> and listens, as above. <PaperCode>onProgress</PaperCode> hears every target of the panel; <PaperCode>status</PaperCode> reads one.</li>
                <li>A page opened in the middle of a backup, including one the panel's own service started, can read <PaperCode>status().progress</PaperCode> and listen for the rest.</li>
                <li>Progress arrives over the page's connection to the computer. When it can't connect, or drops, <PaperCode>onLost</PaperCode> hears why and Paperboard keeps trying; it hears <PaperCode>null</PaperCode> once progress can be heard again. While it lasts, say so in place with a <PaperLink href="/docs/paperui/papererror/">PaperError</PaperLink>, beside what it would update. When it ends, read the status again: a step or an end sent meanwhile is not sent again.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="routine-backups">Routine backups</PaperText>
            <PaperText preset="body" as="p">
                Paperboard has no schedule for backups. A panel that offers routine ones keeps its own schedule, in its config, and runs it from its service: a timer that calls <PaperCode>backupApi.create</PaperCode>, then prunes the panel's routine backups with <PaperCode>list</PaperCode> and <PaperCode>delete</PaperCode>.
                The panel marks which backups are routine itself, such as with a label of its own, and never prunes the ones a person made.
                Because the service runs with Paperboard closed on a server, so do they.
            </PaperText>
            <PaperCode block language="tsx">
{`const ROUTINE = "Routine backup";

async function runRoutineBackup(keep: number) {
    await backupApi.create(PANEL_ID, { label: ROUTINE });
    const routine = (await backupApi.list(PANEL_ID)).filter((b) => b.label === ROUTINE);
    // newest first: the ones past keep are the oldest
    for (const old of routine.slice(keep)) await backupApi.delete(PANEL_ID, old.id);
}`}
            </PaperCode>

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
                    <tr><td><PaperCode>The panel's service is not running, so it can't be backed up</PaperCode>, <PaperCode>This panel's service has no beforeBackup, so it can't be backed up</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>There is no service to ask, or it takes no part in backups.</td></tr>
                    <tr><td><PaperCode>A backup is being made for this target</PaperCode>, <PaperCode>... is being restored ...</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>One is already running for the same target (or, with no target, for the panel).</td></tr>
                    <tr><td><PaperCode>This panel's service has no afterRestore, so it can't restore its backups</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>A restore for a service that couldn't pick up from the files.</td></tr>
                    <tr><td><PaperCode>This backup was made by version &lt;a&gt; of the panel; &lt;b&gt; is installed. Update the panel first</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>A restore of a newer panel's backup.</td></tr>
                    <tr><td><PaperCode>Backup &lt;id&gt; is not at this panel's backup location</PaperCode></td><td><PaperCode>NOT_FOUND</PaperCode></td><td>A wrong id, or a backup at another location.</td></tr>
                    <tr><td><PaperCode>The panel's beforeBackup answered something that is not a backup's contents</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The service named paths that are wrong: outside its folder, inside one another, or none and no data.</td></tr>
                    <tr><td><PaperCode>The downloaded backup does not match its record; it was not restored</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The archive was changed or damaged.</td></tr>
                    <tr><td><PaperCode>The panel could not pick up from the restored files, so they were put back</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td><PaperCode>afterRestore</PaperCode> threw on a restore that went through.</td></tr>
                    <tr><td><PaperCode>label must be at most 100 characters</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A long label.</td></tr>
                    <tr><td><PaperCode>A backup target is a short id: letters, digits, '.', '_' and '-'</PaperCode></td><td>No code</td><td>A target outside the rule. Thrown before anything is sent.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A <PaperCode>beforeBackup</PaperCode> or <PaperCode>beforeRestore</PaperCode> that throws refuses the call with its message.{" "}
                <PaperCode>chooseLocation</PaperCode> rejects with a <PaperCode>BackupLocationError</PaperCode> whose <PaperCode>code</PaperCode> is <PaperCode>unavailable</PaperCode> (<PaperCode>Choosing a backup location needs a panel shown in Paperboard</PaperCode>, or <PaperCode>A widget cannot choose a backup location; open its panel instead</PaperCode>), <PaperCode>busy</PaperCode> (<PaperCode>The backup location window is already open</PaperCode>) or <PaperCode>failed</PaperCode>.
            </PaperText>
        </PaperFlex>
    );
}
