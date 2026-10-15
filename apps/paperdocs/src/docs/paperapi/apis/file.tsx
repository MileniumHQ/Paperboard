import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function FileApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">File API</PaperText>
            <PaperText preset="body">
                fileApi manages a panel's file storage: text file reading and writing, checksummed downloads, and exporting and importing files between panel storage and the user's machine.
                Reach for fileApi when downloading assets, storing local caches, reading persistent working files, or exporting and importing a file.
                Every operation stays inside the named panel's storage folder.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import fileApi or files from @mileniumhq/paperapi.
                Call file operations with paths relative to the panel storage root.
            </PaperText>
            <PaperCode block language="tsx">
{`import { fileApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.panel";

// Write a text file into panel storage (the panel id is always explicit)
await fileApi.write("data/log.txt", "Operation started", PANEL_ID);

// Check file existence
const exists = await fileApi.exists("data/log.txt", PANEL_ID);

// Read file contents
const content = await fileApi.read("data/log.txt", PANEL_ID);`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module provides the following file system methods:
            </PaperText>

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
                        <td><PaperCode>read</PaperCode></td>
                        <td><PaperCode>read(targetPath, appId): Promise&lt;string | null&gt;</PaperCode></td>
                        <td>Reads a UTF-8 text file from panel storage. Returns null if missing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>write(targetPath, content, appId): Promise&lt;string&gt;</PaperCode></td>
                        <td>Writes string content to a file, creating parent directories as needed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>exists(targetPath, appId): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Checks whether the specified file exists.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>delete</PaperCode></td>
                        <td><PaperCode>delete(targetPath, appId): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Deletes a file from panel storage.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getPath</PaperCode></td>
                        <td><PaperCode>getPath(targetPath, appId): Promise&lt;string&gt;</PaperCode></td>
                        <td>Resolves the absolute host file path for a panel-relative path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>clear</PaperCode></td>
                        <td><PaperCode>clear(appId): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Removes all files stored within the panel directory.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>download</PaperCode></td>
                        <td><PaperCode>download(options): Promise&lt;string&gt;</PaperCode></td>
                        <td>Streams a remote URL to disk with progress tracking and SHA-256 verification.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exportFile</PaperCode></td>
                        <td><PaperCode>exportFile(sourcePath, appId, options?): Promise&lt;ExportFileResult&gt;</PaperCode></td>
                        <td>Asks the user where to save a copy of a file from panel storage, then copies it there.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>importFile</PaperCode></td>
                        <td><PaperCode>importFile(targetPath, appId, options?): Promise&lt;ImportFileResult&gt;</PaperCode></td>
                        <td>Asks the user for a file, then copies it into panel storage at targetPath.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                All file paths resolve within ~/.paperboard/files/{"<panelId>"}/.
                Every call names the panel whose storage it touches; a missing or invalid panel id is refused before any request. Path traversal attempts that escape the panel folder are rejected with security errors.
                Downloads verify checksums before committing the temporary file to its final destination.
            </PaperText>

            <PaperText preset="subheader" id="exporting-and-importing-files">Exporting and importing files</PaperText>
            <PaperText preset="body">
                Call exportFile to hand the user a file from panel storage, such as a report or a backup. Call importFile to take a file from the user into panel storage, such as a settings file or a restore.
                Paperboard owns the picker window. The panel names a path in its own storage and never sees a path on the user's disk.
                Call both from a click handler in the panel page. A widget page cannot export or import.
            </PaperText>
            <PaperCode block language="tsx">
{`import { FileTransferError, fileApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.panel";
const filters = [{ name: "Archive", extensions: ["zip"] }];

const exported = await fileApi.exportFile("exports/data.zip", PANEL_ID, { suggestedName: "data.zip", filters });
if (exported.status === "exported") console.log(\`Saved \${exported.bytes} bytes as \${exported.name}\`);

try {
    const imported = await fileApi.importFile("imports/data.zip", PANEL_ID, { filters });
    if (imported.status === "imported") console.log(\`Received \${imported.name}\`);
} catch (err) {
    if (err instanceof FileTransferError && err.code === "too-large") console.log("The file is over the limit");
    else throw err;
}`}
            </PaperCode>

            <PaperText preset="subheader" id="export-and-import-options">Export and import options</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>suggestedName</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The source file's name</td>
                        <td>exportFile only. The file name the picker starts with. Slashes are refused.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>filters</PaperCode></td>
                        <td><PaperCode>FileTypeFilter[]</PaperCode></td>
                        <td>No filters, any file</td>
                        <td>Each filter is <PaperCode>{"{ name, extensions }"}</PaperCode>. Write extensions without the dot, letters and digits only. At most 16 filters of at most 32 extensions each.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="export-and-import-results">Export and import results</PaperText>
            <PaperText preset="body">
                Both methods resolve with what the user did and throw a FileTransferError when the copy fails. A canceled picker resolves with <PaperCode>{"{ status: \"canceled\" }"}</PaperCode> and changes no file.
                A finished exportFile resolves with <PaperCode>{"{ status: \"exported\", name, bytes }"}</PaperCode> and a finished importFile with <PaperCode>{"{ status: \"imported\", name, bytes }"}</PaperCode>. The name is the file name the user picked, without its folder.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>FileTransferError code</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>invalid-request</PaperCode></td>
                        <td>The path, file name, or filters are malformed, or the panel id is not the panel that asked.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>busy</PaperCode></td>
                        <td>This panel already has an export or import running, or Paperboard is running four transfers.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>not-found</PaperCode></td>
                        <td>exportFile: the source file does not exist. The picker never opens.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>too-large</PaperCode></td>
                        <td>The file is over the size limit for its direction.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unreachable</PaperCode></td>
                        <td>The panel's computer is not connected, or it stopped answering during the copy.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unsupported</PaperCode></td>
                        <td>The browser running Paperboard in browser mode cannot pick a save location.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unavailable</PaperCode></td>
                        <td>The page is a widget, or it is not shown inside Paperboard.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>failed</PaperCode></td>
                        <td>Any other failure. The message says what happened.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="export-and-import-behavior">Export and import behavior</PaperText>
            <PaperText preset="body">
                The picker opens on the machine showing Paperboard. When the panel runs on another computer, the file travels between that computer's panel storage and this machine.
                An export writes the picked location only after the whole file arrives. A broken transfer leaves an existing file at that location as it was.
                An import replaces targetPath only after the whole file arrives, and creates its parent folders. The computer that stores the file checks that targetPath stays inside the panel's storage.
                exportFile copies files up to 2 GiB. importFile copies files up to the receiving computer's upload limit, 512 MiB unless PAPERCRANE_DAV_MAX_UPLOAD sets another byte count.
                One export or import per panel runs at a time. A second call while one is open throws <PaperCode>busy</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Download a remote asset with a checksum and progress callback.
            </PaperText>
            <PaperCode block language="tsx">
{`await fileApi.download({
    url: "https://example.com/asset.zip",
    targetPath: "downloads/asset.zip",
    appId: PANEL_ID,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    onProgress: (p) => {
        console.log(\`Download: \${p.percent}%\`);
    }
});`}
            </PaperCode>
        </PaperFlex>
    );
}
