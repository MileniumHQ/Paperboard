import {
    PaperCode,
    PaperContainer,
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
            <PaperText preset="header">Introduction</PaperText>
            <PaperText preset="body">
                An overview of PaperAPI: the runtime bridge that connects panels running inside Paperboard to terminals, processes, packages, and persistent storage.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperAPI</strong> is the JavaScript runtime library used by Paperboard panels. A panel is a web application rendered in an isolated frame inside the Paperboard desktop application; PaperAPI exposes the host's capabilities to that application through a small set of namespaced APIs.
            </PaperText>
            <PaperText preset="body">
                Every call passes through a guarded bridge between the panel frame and the Paperboard main process. The host validates each channel and confines file operations to per-panel storage, so panels run with the capabilities they need and nothing more. Calls made outside Paperboard — for example in a plain browser tab during development — reject with an error rather than failing silently.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Runtime requirement">
                Terminal, process, package, file, and system calls resolve only when the panel runs inside Paperboard, either on the local machine or through a paired remote computer.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="api-inventory" preset="subheader">
                API inventory
            </PaperText>
            <PaperText preset="body">
                PaperAPI exports one namespace per capability:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Namespace</th>
                        <th>Purpose</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td>Cross-panel RPC, background service definition, and reactive state sync.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>terminal</PaperCode></td>
                        <td>Create interactive pseudo-terminal sessions and stream their output.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>process</PaperCode></td>
                        <td>Start supervised background processes and read their output streams.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>packages</PaperCode></td>
                        <td>Install and query runtime packages such as Java or Node from the registry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>files</PaperCode></td>
                        <td>Read and write files inside the panel's isolated storage directory.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>config</PaperCode></td>
                        <td>Persist small JSON configuration documents per panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>system</PaperCode></td>
                        <td>Query host information such as the primary LAN IP address.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="installation" preset="subheader">
                Installation
            </PaperText>
            <PaperCode block language="bash">
                {`bun add @paperboard-dev/paperapi`}
            </PaperCode>
            <PaperText preset="body">
                PaperAPI pairs naturally with <PaperLink href="/paperui/introduction">PaperUI</PaperLink>, which supplies the interface components most panels are built from. The quick start guide walks through a minimal project containing both.
            </PaperText>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/quick-start">Quick start</PaperLink> — Set up an empty panel project with PaperUI and PaperAPI.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/overview">CLI</PaperLink> — Development linking and release packaging commands.
                </PaperText>
            </PaperTextList>
        </>
    );
}
