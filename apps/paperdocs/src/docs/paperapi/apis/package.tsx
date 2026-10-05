import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PackageApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Package API</PaperText>
            <PaperText preset="body">
                packageApi manages installation, verification, and filesystem
                paths for system tool packages and binaries. Reach for
                packageApi when downloading precompiled runtimes, game server
                binaries, or CLI utilities. The package manager tracks download
                stages, extraction, and verification hashes.
            </PaperText>

            <PaperText preset="subheader" id="overview">
                Overview
            </PaperText>
            <PaperText preset="body">
                Import packageApi or packages from @mileniumhq/paperapi.
                Verify package installation state or initiate downloads with
                stage tracking.
            </PaperText>
            <PaperCode block language="tsx">
                {`import { packageApi } from "@mileniumhq/paperapi";

// Verify if a package is installed
const installed = await packageApi.isInstalled("java-25");

if (!installed) {
    // Download and extract package
    await packageApi.download("java-25", (progress) => {
        console.log(progress.stage, progress.percent);
    });
}`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">
                Methods and signatures
            </PaperText>
            <PaperText preset="body">
                The module provides the following tool management methods:
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
                        <td>
                            <PaperCode>isInstalled</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                isInstalled(name, version?):
                                Promise&lt;boolean&gt;
                            </PaperCode>
                        </td>
                        <td>
                            Returns true if the tool package exists in the
                            daemon tool storage.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>download</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                download(name, onProgress?):
                                Promise&lt;string&gt;
                            </PaperCode>
                        </td>
                        <td>
                            Downloads, verifies, and unpacks the named package.
                            Returns the binary path.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>getPath</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                getPath(name): Promise&lt;string&gt;
                            </PaperCode>
                        </td>
                        <td>
                            Resolves the absolute path to the package binary
                            executable.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>getIndex</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                getIndex(): Promise&lt;Record&lt;string,
                                any&gt;&gt;
                            </PaperCode>
                        </td>
                        <td>
                            Returns an inventory of installed tool packages and
                            their versions.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">
                Behavior
            </PaperText>
            <PaperText preset="body">
                Downloads dispatch events through stages: checking, downloading,
                verifying, extracting, and completed. Unpacking is performed
                inside isolated tool directories managed by the Paperboard
                daemon.
            </PaperText>

            <PaperText preset="subheader" id="recipes">
                Recipes
            </PaperText>
            <PaperText preset="body">
                Query the filesystem path to execute an installed utility
                binary.
            </PaperText>
            <PaperCode block language="tsx">
                {`const binaryPath = await packageApi.getPath("java-25");
console.log("Binary location:", binaryPath);`}
            </PaperCode>
        </PaperFlex>
    );
}
