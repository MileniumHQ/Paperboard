import {
    PaperCode,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Package API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>packages</PaperCode> namespace: installing runtime packages such as Java, Python, or Node from the Paperboard registry, and querying what is already present.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>Package API</strong> gives panels a shared, user-level package manager. Packages are downloaded once per machine into the host's package directory; any panel can then depend on them without bundling its own runtimes. Installation resolves platform-specific archives from the registry and verifies their checksums.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Idempotent installs">
                Downloading an already-installed package resolves immediately with its path. Panels should call isInstalled first to skip the progress flow entirely.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`import { packages } from "@paperboard-dev/paperapi";

if (!(await packages.isInstalled("java-21"))) {
    await packages.download("java-21", (progress) => {
        setPercent(progress.percent);       // 0-100
        setMessage(progress.message);
        // progress.stage: checking | downloading |
        // verifying | extracting | completed | error
        // bytesLoaded / bytesTotal when available
    });
}

const javaPath = await packages.getPath("java-21");
// -> directory containing bin/ ; prepend
// ${"${javaPath}"}/bin to PATH when spawning processes`}
            </PaperCode>

            <PaperText preset="body">
                The installed-package index records what is present, when it was installed, and at which version:
            </PaperText>
            <PaperCode block language="tsx">
                {`const index = await packages.getIndex();
// { "java-21": { version: "21.0.3", installedAt: "...", ... } }`}
            </PaperCode>

            <PaperSeparator />

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
                        <td><PaperCode>download</PaperCode></td>
                        <td><PaperCode>(name, onProgress?) =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Installs a package and resolves with its install directory.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isInstalled</PaperCode></td>
                        <td><PaperCode>(name, version?) =&gt; Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Returns whether the package (optionally at a version) is installed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getIndex</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;Record&gt;</PaperCode></td>
                        <td>Returns all installed packages with metadata.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getPath</PaperCode></td>
                        <td><PaperCode>(name) =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Returns the directory containing the package's bin folder.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="body">
                Progress payloads use the <PaperCode>PackageProgress</PaperCode> shape: stage, percent, optional bytesLoaded and bytesTotal, and an optional human-readable message.
            </PaperText>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/process">Process API</PaperLink> — Spawn programs using installed package paths.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/files">Files API</PaperLink> — Download panel-specific assets separately from shared packages.
                </PaperText>
            </PaperTextList>
        </>
    );
}
