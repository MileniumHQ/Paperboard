import {
    PaperCode,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperLink,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Files API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>files</PaperCode> namespace: reading, writing, and downloading files inside the panel's isolated storage directory.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>Files API</strong> provides persistent storage scoped to the calling panel. Every path is resolved relative to a per-panel directory under the host's data folder, and paths that attempt to escape that directory are rejected. A panel cannot read or write anywhere else on the host filesystem.
            </PaperText>

            <PaperQuote variant="yellow" icon="shield" title="Storage scope">
                Paths are sandboxed. Writing "config.json" lands in the panel's own storage directory regardless of the working directory; "../other-panel/file" is denied.
            </PaperQuote>

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`import { files } from "@paperboard-dev/paperapi";

await files.write("settings/theme.txt", "dark");
const theme = await files.read("settings/theme.txt");

if (await files.exists("world/level.dat")) {
    const path = await files.getPath("world/level.dat");
    // absolute path, useful for handing to process.cwd
}

// Remove everything in this panel's storage:
await files.clear();`}
            </PaperCode>

            <PaperText id="downloads" preset="subheader">
                Downloads
            </PaperText>
            <PaperText preset="body">
                Large assets are streamed by the host with progress reporting and optional checksum verification:
            </PaperText>
            <PaperCode block language="tsx">
                {`import { files } from "@paperboard-dev/paperapi";

await files.download({
    url: "https://example.com/paper-1.21.jar",
    targetPath: "server/paper.jar",
    sha256: "<expected-sha256>",
    onProgress: (p) => setPercent(p.percent),
});`}
            </PaperCode>

            <PaperText id="reference" preset="subheader">
                Reference
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
                        <td><PaperCode>(path) =&gt; Promise&lt;string | null&gt;</PaperCode></td>
                        <td>Returns file contents as text, or null when absent.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>(path, content) =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Writes text (creating parent directories); resolves with the absolute path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exists</PaperCode></td>
                        <td><PaperCode>(path) =&gt; Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Returns whether the path exists.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getPath</PaperCode></td>
                        <td><PaperCode>(path) =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Resolves a sandboxed relative path to its absolute host path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>download</PaperCode></td>
                        <td><PaperCode>(options) =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Streams a URL into storage; supports sha1/sha256 verification and progress callbacks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>clear</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Empties the panel's entire storage directory.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/package">Package API</PaperLink> — Shared runtimes, installed once per machine rather than per panel.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/config">Config API</PaperLink> — Structured JSON persistence for settings.
                </PaperText>
            </PaperTextList>
        </>
    );
}
