import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function FileApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">fileApi</PaperText>
            <PaperText preset="body" as="p">
                fileApi reads, writes and downloads files in the panel's own storage folder, and moves files between that folder and the person's computer.
                Storage and downloads work on a panel page, in a widget and in a service. Export and import open a system dialog, so they work only on a panel page.
                Paths are relative to the panel's folder. Nothing outside it can be named.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { fileApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

await fileApi.write("history/lisbon.json", JSON.stringify(readings), PANEL_ID);
const text = await fileApi.read("history/lisbon.json", PANEL_ID);
if (text === null) throw new Error("No history saved for Lisbon yet");

const radar = await fileApi.download({
    url: "https://example.com/radar.png",
    targetPath: "cache/radar.png",
    appId: PANEL_ID,
    sha256: expectedSha256,
    onProgress: (p) => setProgress(p.percent),
});`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="storage">Storage</PaperText>
            <PaperCode block language="tsx">
{`/** the absolute path on disk; "" is the folder itself */
fileApi.getPath(targetPath: string, appId: string): Promise<string>;
fileApi.exists(targetPath: string, appId: string): Promise<boolean>;
/** creates parent folders; resolves with the absolute path */
fileApi.write(targetPath: string, content: string, appId: string): Promise<string>;
/** null when there is no such file */
fileApi.read(targetPath: string, appId: string): Promise<string | null>;
/** true when a file was deleted; false for a folder or a missing file */
fileApi.delete(targetPath: string, appId: string): Promise<boolean>;
/** deletes the whole storage folder */
fileApi.clear(appId: string): Promise<true>;`}
            </PaperCode>
            <PaperTextList>
                <li>The folder is <PaperCode>files/&lt;panelId&gt;/</PaperCode> in the Paperboard data folder. <PaperCode>appId</PaperCode> is the panel id, and only the caller's own.</li>
                <li><PaperCode>read</PaperCode> and <PaperCode>write</PaperCode> handle UTF-8 text, at most 16 MiB a write. For larger or binary files, use <PaperCode>download</PaperCode>, or the path from <PaperCode>getPath</PaperCode> with Node's <PaperCode>fs</PaperCode> in the service.</li>
                <li>A path that climbs out of the folder, or passes through a symbolic link, is refused.</li>
                <li><PaperCode>delete</PaperCode> removes files only. <PaperCode>clear</PaperCode> removes the folder and everything in it.</li>
                <li>Backups include the folder. See <PaperLink href="/docs/paperapi/backups/">backupApi</PaperLink>.</li>
                <li>For a panel shown from another computer, the folder and every path are on that computer.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="downloads">Downloads</PaperText>
            <PaperCode block language="tsx">
{`fileApi.download(opts: FileDownloadOptions): Promise<string>;

interface FileDownloadOptions {
    url: string;
    /** where the file goes in the panel's folder */
    targetPath: string;
    appId: string;
    sha1?: string;
    sha256?: string;
    /** the same check in one field; only "sha1" and "sha256" are checked */
    checksum?: { algorithm: "sha1" | "sha256" | "md5" | string; value: string };
    onProgress?: (progress: FileDownloadProgress) => void;
}

interface FileDownloadProgress {
    downloadId: string;
    stage: "starting" | "downloading" | "verifying" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    /** the failure, on the "error" stage */
    message?: string;
}`}
            </PaperCode>
            <PaperTextList>
                <li>The daemon downloads the file, and the call has no timeout.</li>
                <li>Only <PaperCode>http:</PaperCode> and <PaperCode>https:</PaperCode> URLs are fetched. Give a checksum for anything the panel will run.</li>
                <li>The file arrives under a temporary name and replaces <PaperCode>targetPath</PaperCode> only once it is complete and its checksum matches. A failed download leaves the old file alone.</li>
                <li>A checksum with an <PaperCode>algorithm</PaperCode> other than <PaperCode>sha1</PaperCode> or <PaperCode>sha256</PaperCode> is not checked.</li>
                <li>Limits: 2 GiB per file, 8 downloads at once on the computer, 45 seconds without data, 30 minutes in all.</li>
                <li>Resolves with the absolute path of the downloaded file.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="export-and-import">Export and import</PaperText>
            <PaperCode block language="tsx">
{`fileApi.exportFile(sourcePath: string, appId: string, options?: ExportFileOptions): Promise<ExportFileResult>;
fileApi.importFile(targetPath: string, appId: string, options?: ImportFileOptions): Promise<ImportFileResult>;
fileApi.importFiles(targetDir: string, appId: string, options?: ImportFileOptions): Promise<ImportFilesResult>;
fileApi.importFolder(targetDir: string, appId: string): Promise<ImportFolderResult>;

interface ExportFileOptions {
    /** the name the dialog starts with; defaults to the source file's */
    suggestedName?: string;
    filters?: FileTypeFilter[];
}
interface ImportFileOptions {
    filters?: FileTypeFilter[];
}
interface FileTypeFilter {
    /** the label the dialog shows, such as "Backups" */
    name: string;
    /** extensions without the dot, such as ["zip"] */
    extensions: string[];
}

type ExportFileResult = { status: "exported"; name: string; bytes: number } | { status: "canceled" };
type ImportFileResult = { status: "imported"; name: string; bytes: number } | { status: "canceled" };
type ImportFilesResult = { status: "imported"; files: ImportedFile[]; bytes: number } | { status: "canceled" };
type ImportFolderResult = { status: "imported"; name: string; files: ImportedFile[]; bytes: number } | { status: "canceled" };
interface ImportedFile {
    /** the file's name, or its path below the chosen folder */
    name: string;
    bytes: number;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The shell opens the system dialog and copies the file. The panel names only the path in its own folder, and never learns where the person picked or saved.
                A canceled dialog resolves with <PaperCode>{"{ status: \"canceled\" }"}</PaperCode>; it is not an error.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>What it copies</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>exportFile</PaperCode></td><td>One file from the panel's folder to where the person chooses. At most 2 GiB.</td></tr>
                    <tr><td><PaperCode>importFile</PaperCode></td><td>One chosen file to <PaperCode>targetPath</PaperCode>, replacing what was there once it fully arrives.</td></tr>
                    <tr><td><PaperCode>importFiles</PaperCode></td><td>One or more chosen files into the folder <PaperCode>targetDir</PaperCode>, each under its own name. Files already copied stay if a later one fails.</td></tr>
                    <tr><td><PaperCode>importFolder</PaperCode></td><td>A chosen folder and everything in it into <PaperCode>targetDir/&lt;folder name&gt;</PaperCode>. A folder with a link in it is refused before anything is copied.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                An import holds at most 5000 files and 2 GiB in all.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                Export and import reject with a <PaperCode>FileTransferError</PaperCode>, whose <PaperCode>code</PaperCode> is <PaperCode>invalid-request</PaperCode>, <PaperCode>busy</PaperCode>, <PaperCode>not-found</PaperCode>, <PaperCode>too-large</PaperCode>, <PaperCode>unreachable</PaperCode>, <PaperCode>unsupported</PaperCode>, <PaperCode>unavailable</PaperCode> or <PaperCode>failed</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Access denied: path traverses outside assigned storage for &lt;panel&gt;</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A path with <PaperCode>..</PaperCode> that leaves the folder.</td></tr>
                    <tr><td><PaperCode>Access denied: symbolic link in storage path for &lt;panel&gt;</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The path passes through a link.</td></tr>
                    <tr><td><PaperCode>Cross-panel access refused: credential is scoped to "&lt;panel&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>Another panel's <PaperCode>appId</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Download refused: only http(s) URLs are downloaded, not &lt;scheme&gt;</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>A <PaperCode>file:</PaperCode>, <PaperCode>ftp:</PaperCode> or other URL.</td></tr>
                    <tr><td><PaperCode>Download failed (HTTP &lt;status&gt;)</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The server answered with an error.</td></tr>
                    <tr><td><PaperCode>SHA1 mismatch</PaperCode>, <PaperCode>SHA256 mismatch</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>The file is not the one the checksum names.</td></tr>
                    <tr><td><PaperCode>Too many concurrent downloads (max 8)</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>Eight downloads are running.</td></tr>
                    <tr><td><PaperCode>Download exceeds 2 GiB cap</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>The file is too large.</td></tr>
                    <tr><td><PaperCode>Download connection timed out</PaperCode>, <PaperCode>Download stalled</PaperCode>, <PaperCode>Download exceeded lifetime deadline</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td>No data for 45 seconds, or 30 minutes in all.</td></tr>
                    <tr><td><PaperCode>Exporting and importing files needs a panel shown in Paperboard</PaperCode></td><td><PaperCode>unavailable</PaperCode></td><td>Called from a service, or from a page outside the shell.</td></tr>
                    <tr><td><PaperCode>A widget cannot export or import files; open its panel instead</PaperCode></td><td><PaperCode>unavailable</PaperCode></td><td>Called from a widget.</td></tr>
                    <tr><td><PaperCode>An export or import is already running</PaperCode></td><td><PaperCode>busy</PaperCode></td><td>The page started a second one before the first finished.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
