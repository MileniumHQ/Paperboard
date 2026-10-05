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
                fileApi manages file storage, text file reading and writing, and checksummed file downloads within panel sandboxes.
                Reach for fileApi when downloading assets, storing local caches, or reading persistent working files.
                All operations are sandboxed to the active panel data directory.
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
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                All file paths resolve within ~/.paperboard/files/{"<panelId>"}/.
                Every call names the panel whose storage it touches; a missing or invalid panel id is refused before any request. Path traversal attempts that escape the panel folder are rejected with security errors.
                Downloads verify checksums before committing the temporary file to its final destination.
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
