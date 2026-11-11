import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PackageApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">packageApi</PaperText>
            <PaperText preset="body" as="p">
                packageApi installs runtimes and tools, such as Java, from the Paperboard registry onto the computer the panel runs on.
                It works on a panel page, in a widget and in a service. Packages are shared by every panel on the computer.
                Install a package the panel needs instead of asking the person to set it up.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`// in the service
import { packageApi, processApi } from "@mileniumhq/paperapi";

if (!(await packageApi.isInstalled("java"))) {
    await packageApi.download("java", (p) => setStatus(\`\${p.stage} \${p.percent}%\`));
}
const bin = await packageApi.getPath("java");
const java = process.platform === "win32" ? \`\${bin}\\\\java.exe\` : \`\${bin}/java\`;
const result = await processApi.exec(java, ["-version"]);`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`packageApi.download(packageName: string, onProgress?: (progress: PackageProgress) => void): Promise<string>;
packageApi.isInstalled(packageName: string, version?: string): Promise<boolean>;
packageApi.getPath(packageName: string): Promise<string>;
packageApi.getIndex(): Promise<Record<string, InstalledPackageRecord | string>>;
packageApi.pendingUpdates(): Promise<PendingPackageUpdate[]>;

interface PackageProgress {
    stage: "checking" | "downloading" | "verifying" | "extracting" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

interface InstalledPackageRecord {
    version?: string;
    installedAt?: string;
    path?: string;
    [key: string]: unknown;
}

interface PendingPackageUpdate {
    name: string;
    version: string;
    /** the caller's processes still running the installed release */
    blockedBy: Array<{ processId: string; owner: string | null }>;
    error?: string;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>download</PaperCode></td>
                        <td>Installs the registry's current release for this computer's system and processor, or updates to it. Resolves with the package's folder. A release that is already installed resolves at once. The call has no timeout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isInstalled</PaperCode></td>
                        <td>True when the package is installed with a <PaperCode>bin</PaperCode> folder. With <PaperCode>version</PaperCode>, also checks that it is that version. <PaperCode>"latest"</PaperCode> means any version.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getPath</PaperCode></td>
                        <td>The package's <PaperCode>bin</PaperCode> folder, found up to 4 levels down. It returns a path even when the package is not installed, so call <PaperCode>isInstalled</PaperCode> first.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getIndex</PaperCode></td>
                        <td>Every installed package, keyed by name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pendingUpdates</PaperCode></td>
                        <td>Updates the caller's own processes hold back. See below.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="updates">Updates</PaperText>
            <PaperTextList>
                <li>A package update is downloaded and verified while the old release keeps running. It replaces the old release only when no process runs from it.</li>
                <li>Until then, <PaperCode>download</PaperCode> resolves and the update waits. <PaperCode>pendingUpdates</PaperCode> lists it with the caller's processes that hold it back, and only those.</li>
                <li>Stop those processes, and the next start installs the update before the process runs.</li>
                <li>A release older than the installed one is refused. Only Paperboard itself can downgrade a package.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="trust">Trust</PaperText>
            <PaperTextList>
                <li>The daemon fetches the package's record from the registry it installs panels from, and refuses a release the Paperboard release key did not sign, or whose sha256 does not match the signed one.</li>
                <li>A release that unpacks without a <PaperCode>bin</PaperCode> folder is removed and refused.</li>
                <li>Packages live in <PaperCode>packages/&lt;name&gt;</PaperCode> in the Paperboard data folder.</li>
                <li>A panel that calls <PaperCode>download</PaperCode>, <PaperCode>isInstalled</PaperCode> or <PaperCode>getPath</PaperCode> for a package uses it. A package stays while a panel that uses it is installed. Once the last one is uninstalled, the package is removed. If a process still runs from it, it is removed at the next uninstall or daemon start after that process stops.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Install refused for package "&lt;name&gt;": registry record unavailable (&lt;reason&gt;)</PaperCode></td><td>The registry is unreachable, or has no package of that name.</td></tr>
                    <tr><td><PaperCode>No download available for &lt;name&gt; on &lt;os&gt;-&lt;arch&gt;</PaperCode></td><td>The package has no release for this system, such as <PaperCode>linux-arm64</PaperCode>.</td></tr>
                    <tr><td><PaperCode>An operation on &lt;name&gt; is already running</PaperCode></td><td>Another install of the same package is running.</td></tr>
                    <tr><td><PaperCode>Too many concurrent installs</PaperCode></td><td>Eight installs are running.</td></tr>
                    <tr><td><PaperCode>Package &lt;name&gt; extracted but no usable binary directory was found. Removed partial install.</PaperCode></td><td>The release has no <PaperCode>bin</PaperCode> folder.</td></tr>
                    <tr><td><PaperCode>Release rollback refused: &lt;version&gt; is not newer than &lt;installed&gt;</PaperCode></td><td>The registry's release is older than the installed one.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
