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
            <PaperText preset="header">System API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>system</PaperCode> namespace: querying host information exposed to panels.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>System API</strong> exposes host information for the computer the panel is scoped to — the local machine, or a paired remote computer when the panel is opened for one. All calls resolve against that target: a panel opened for a remote computer receives <em>that computer's</em> details, never the local machine's.
            </PaperText>
            <PaperText preset="body">
                <PaperCode>getLocalIP</PaperCode> resolves the target's primary LAN IPv4 address. Panels that advertise a local service — a game server browser page, a web dashboard link — need this address to construct reachable URLs for other devices on the network. <PaperCode>getInfo</PaperCode> returns the full system profile (OS, architecture, hostname, version) from the same source.
            </PaperText>

            <PaperQuote variant="yellow" icon="warning" title="Network scope">
                The address is the target's LAN IP (typically 192.168.x.x or 10.x.x.x). It is reachable only from the same network; it is not a public address.
            </PaperQuote>

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`import { system } from "@paperboard-dev/paperapi";

const ip = await system.getLocalIP();
// e.g. "192.168.1.42"

setShareUrl(\`http://\${ip}:25565\`);`}
            </PaperCode>
            <PaperCode block language="tsx">
                {`const info = await system.getInfo();
// { hostname, os, osVersion, distroName, arch, ip, version, ... }

if (info.os === "windows") {
    // Windows-specific paths or commands
}`}
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
                        <td><PaperCode>getLocalIP</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;string&gt;</PaperCode></td>
                        <td>Resolves the primary private LAN IPv4 address of the target computer.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getInfo</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;SystemInfo&gt;</PaperCode></td>
                        <td>Full system profile of the target computer: hostname, OS, version, distro, architecture, LAN IP, and daemon version.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/process">Process API</PaperLink> — Start the services these addresses point at.
                </PaperText>
            </PaperTextList>
        </>
    );
}
