import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PanelsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">panelsApi</PaperText>
            <PaperText preset="body" as="p">
                panelsApi lists the panels installed on a computer and the panels the registry offers, and restarts or uninstalls the calling panel.
                It works on a panel page, in a widget and in a service.
                Installing panels, and acting on any panel but the caller, belong to Paperboard itself.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { panelsApi } from "@mileniumhq/paperapi";

const installed = await panelsApi.list();
const hasTerminal = installed.some((panel) => panel.id === "dev.paperboard.terminal");

// after the settings page changes how the service starts
await panelsApi.restartService("dev.example.weather");`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`panelsApi.list(scope?: string): Promise<PanelItem[]>;
panelsApi.registry(scope?: string): Promise<PanelItem[]>;
/** false when the panel declares no service */
panelsApi.restartService(panelId: string, scope?: string): Promise<boolean>;
panelsApi.uninstall(panelId: string, scope?: string, options?: { deleteData?: boolean }): Promise<boolean>;
/** uninstall, keeping the data */
panelsApi.remove(panelId: string, scope?: string): Promise<boolean>;
/** Paperboard only */
panelsApi.install(panelId: string, scope?: string): Promise<unknown>;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>Who may call it</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td>Any panel</td>
                        <td>Every installed panel on the computer, from its own manifest. A panel whose manifest the daemon refuses is left out; run <PaperLink href="/docs/paperapi/cli/#doctor">paperapi doctor</PaperLink> to see why.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>registry</PaperCode></td>
                        <td>Any panel</td>
                        <td>Every panel the registry offers, merged with the installed ones. An installed panel keeps its own name, version and manifest, and gains <PaperCode>latestVersion</PaperCode>. Installed panels the registry doesn't list come after. Rejects when either list can't be read.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>restartService</PaperCode></td>
                        <td>The panel itself</td>
                        <td>Stops the service, starts it again and waits for it to report ready, for at most 60 seconds. Processes and terminals the panel started keep running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>uninstall</PaperCode></td>
                        <td>The panel itself</td>
                        <td>Stops the service and every process the panel owns, removes its code and revokes its credentials. Its config, files, secrets and port claims stay, unless <PaperCode>deleteData</PaperCode> is <PaperCode>true</PaperCode>. The call has no timeout.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>install</PaperCode></td>
                        <td>Paperboard only</td>
                        <td>Installs or updates a panel from the registry. A panel's call is refused.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="panel-item">PanelItem</PaperText>
            <PaperCode block language="tsx">
{`interface PanelItem {
    id: string;
    name: string;
    /** the installed version when installed, else the registry's */
    version?: string;
    description?: string;
    publisher?: string;
    /** the manifest's icon path */
    icon?: string;
    /** registry only: where the icon and the archive are served */
    iconUrl?: string;
    downloadUrl?: string;
    /** registry only */
    latestVersion?: string;
    archiveBytes?: number;
    store?: StoreListing;
    /** registry only: the release date, formatted for display */
    updatedAt?: string;
    isInstalled?: boolean;
    installedVersion?: string;
    /** "dev" for a panel linked with paperapi link */
    installSource?: "dev";
    isLinked?: boolean;
    /** from the installed manifest, already validated */
    widgets?: WidgetDeclaration[];
    tutorial?: TutorialStep[];
    service?: string;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                In <PaperCode>registry</PaperCode>, a field the registry does not give is absent, never filled in. <PaperCode>archiveBytes</PaperCode> is the size of the newest release in bytes.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="registry">Registry</PaperText>
            <PaperTextList>
                <li>The registry is <PaperCode>https://origami.ariapis.com</PaperCode>, or the URL in the <PaperCode>ORIGAMI_REGISTRY_URL</PaperCode> environment variable where the code runs. It is exported as <PaperCode>REGISTRY_URL</PaperCode>, and the library page as <PaperCode>PANEL_LIBRARY_URL</PaperCode>.</li>
                <li><PaperCode>registry</PaperCode> fetches <PaperCode>/panels/index.json</PaperCode> from the document or service that calls it, not the daemon: the code needs internet access.</li>
                <li>The fetch gives up after 10 seconds and refuses an index over 1 MB. <PaperCode>fetchRegistryIndex()</PaperCode> and <PaperCode>fetchRegistryJson(url, timeoutMs?, maxBytes?)</PaperCode> do the same fetch, and <PaperCode>mergeRegistryWithInstalled</PaperCode> the same merge.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Cross-panel access refused: credential is scoped to "&lt;panel&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td><PaperCode>restartService</PaperCode> or <PaperCode>uninstall</PaperCode> for another panel.</td></tr>
                    <tr><td><PaperCode>panel:install is host-only</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>A panel called <PaperCode>install</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Install refused for "&lt;id&gt;": the registry does not list "&lt;id&gt;"</PaperCode></td><td>No code</td><td><PaperCode>install</PaperCode> looks the panel up in the registry before it asks the daemon, so an unlisted id fails here first.</td></tr>
                    <tr><td><PaperCode>Restart failed: Panel &lt;id&gt; is not installed</PaperCode></td><td><PaperCode>INTERNAL</PaperCode></td><td><PaperCode>restartService</PaperCode> for a panel that isn't there.</td></tr>
                    <tr><td><PaperCode>Registry returned HTTP &lt;status&gt;</PaperCode></td><td>No code</td><td>The registry answered with an error.</td></tr>
                    <tr><td><PaperCode>Registry index exceeds 1048576 bytes; refusing to parse</PaperCode></td><td>No code</td><td>The index is over the cap.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
