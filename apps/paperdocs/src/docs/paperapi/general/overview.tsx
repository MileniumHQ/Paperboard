import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperApiOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperAPI</PaperText>
            <PaperText preset="body" as="p">
                PaperAPI is the TypeScript SDK a panel uses to talk to the Paperboard server daemon on its computer.
                Import it in the panel page, the panel service, and the widget page.
                Every call goes over one authenticated WebSocket to the daemon, which owns storage, processes, secrets and the block registry.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="install">Install</PaperText>
            <PaperText preset="body" as="p">
                Add the package to the panel. It ships the SDK and the <PaperCode>paperapi</PaperCode> command.
            </PaperText>
            <PaperCode block language="sh">
{`bun add @mileniumhq/paperapi`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Every export comes from the package root. Each API has a long name and a short alias that point at the same object: <PaperCode>configApi</PaperCode> and <PaperCode>config</PaperCode>, <PaperCode>secretsApi</PaperCode> and <PaperCode>secrets</PaperCode>.
                The short alias <PaperCode>process</PaperCode> shadows Node's global <PaperCode>process</PaperCode>, so import <PaperCode>processApi</PaperCode> in a service.
            </PaperText>
            <PaperCode block language="tsx">
{`import { configApi, secretsApi, processApi } from "@mileniumhq/paperapi";`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="contexts">Where code runs</PaperText>
            <PaperText preset="body" as="p">
                A panel has up to three places its code runs. Each one connects to the daemon with its own credential, and each API page states which of them it works in.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Context</th>
                        <th>What it is</th>
                        <th>Identity comes from</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Panel page</td>
                        <td><PaperCode>index.html</PaperCode> of the panel build, shown in a frame of the Paperboard window.</td>
                        <td>The host injects <PaperCode>window.__PAPERBOARD_CRANE</PaperCode> into every HTML file it serves for the panel, carrying a token scoped to the panel.</td>
                    </tr>
                    <tr>
                        <td>Service</td>
                        <td>The script the manifest names in <PaperCode>service</PaperCode>, run by the Paperboard server daemon as a child process with Node or Bun. It keeps running when the Paperboard window is closed.</td>
                        <td>The environment the daemon starts it with: <PaperCode>PAPERBOARD_PANEL_ID</PaperCode>, <PaperCode>PAPERCRANE_PANEL_TOKEN</PaperCode>, <PaperCode>PAPERCRANE_PORT</PaperCode> and <PaperCode>PAPERBOARD_DIR</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td>Widget page</td>
                        <td><PaperCode>widget.html</PaperCode> of the panel build, shown on Home. One frame shows one placed widget.</td>
                        <td>The same injection as the panel page.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The panel page and the widget page find their identity without any setup.
                A service does too, as long as it is started by the daemon.
                <PaperLink href="/docs/paperapi/connection/">Connection and identity</PaperLink> covers the rare case of connecting by hand.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="apis">The APIs</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperLink href="/docs/paperapi/config/">configApi</PaperLink></td><td>JSON documents the panel saves: settings and workspace files.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink></td><td>API keys, tokens and passwords, kept apart from config and files.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/file/">fileApi</PaperLink></td><td>The panel's file storage, downloads, and the export and import windows.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/process/">processApi</PaperLink></td><td>Programs the daemon starts and supervises for the panel.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/terminal/">terminalApi</PaperLink></td><td>Interactive shells with a pseudo terminal.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/package/">packageApi</PaperLink></td><td>Runtimes and tools from the Origami registry, such as Java.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/ports/">portApi</PaperLink></td><td>Network ports the panel's programs listen on, without clashes.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/backups/">backupApi</PaperLink></td><td>Backups of the panel's files and config, made now or on a schedule.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/blocks/">blocksApi</PaperLink></td><td>Blocks: the commands, values and events other panels, flows and agents use.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink></td><td>The service's entry point: state, calls and lifecycle hooks.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/bridge/">createPanelBridge</PaperLink></td><td>The panel page's view of its service: state and calls.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/widgets/">defineWidgets</PaperLink></td><td>The widget page's mount functions.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/system/">systemApi</PaperLink></td><td>Facts about the computer: OS, address, GPUs, usage.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/panels/">panelsApi</PaperLink></td><td>Installed panels and the Panel Library.</td></tr>
                    <tr><td><PaperLink href="/docs/paperapi/shell/">resolveOneShotShell</PaperLink></td><td>The platform shell for running one command line.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The manifest and its <PaperLink href="/docs/paperapi/store-listing/">store listing</PaperLink> describe the panel to Paperboard.
                The <PaperLink href="/docs/paperapi/cli/">paperapi command</PaperLink> links, checks, calls, watches and packs a panel during development.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="trust">Trust and authority</PaperText>
            <PaperText preset="body" as="p">
                Panels are reviewed and first-party, and they are not sandboxed.
                A panel can start any program and reach any HTTPS address.
                What the daemon does enforce is ownership: a panel's credential reads and writes only that panel's config, files, secrets, ports, backups and processes.
                <PaperLink href="/docs/paperapi/permissions/">Permissions</PaperLink> lists exactly what a panel credential can and cannot do.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="side-effects">What importing does</PaperText>
            <PaperText preset="body" as="p">
                Importing the package in a frame installs three listeners and nothing else:
            </PaperText>
            <PaperTextList>
                <li>The readiness handler, which answers the shell's start-up check once the page is connected, its service answers, and its first paint has landed.</li>
                <li>A forwarder that sends PaperUI's haptic requests to the shell, because a frame cannot vibrate the device itself.</li>
                <li>A forwarder that sends PaperUI's back-swipe gesture on a panel page to the shell. A widget keeps its swipes.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The connection opens on the first call, or in a frame when the shell sends its start-up check, whichever comes first.
                In a service, the first call is usually the block registration <PaperCode>definePanelService</PaperCode> makes.
            </PaperText>

            <PaperText preset="body" as="p">
                Start with <PaperLink href="/docs/paperapi/manifest/">the panel manifest</PaperLink>, then <PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
