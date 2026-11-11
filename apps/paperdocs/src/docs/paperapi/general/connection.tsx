import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ConnectionDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Connection and identity</PaperText>
            <PaperText preset="body" as="p">
                How PaperAPI finds the daemon, which panel it speaks for, and what a failed call looks like.
                Panel pages, widget pages and services connect on their own, so most panels never call anything here except <PaperCode>getPanelId</PaperCode> or <PaperCode>requirePanelId</PaperCode>.
                Reach for <PaperCode>initPaperApi</PaperCode> only in a script the daemon did not start.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { getPanelId, requirePanelId, grantedComputerId } from "@mileniumhq/paperapi";

// "dev.example.weather" on its own page, widget page or service
const panelId = requirePanelId(getPanelId());

// "local" for the computer this window runs on, or a paired computer's id
const computerId = grantedComputerId();`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="identity">How identity is found</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Context</th>
                        <th>Source</th>
                        <th>Credential</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Panel page, widget page</td>
                        <td><PaperCode>window.__PAPERBOARD_CRANE</PaperCode>, injected by the host into the <PaperCode>head</PaperCode> of every HTML file it serves for the panel: <PaperCode>{"{ port, token, scoped, computerId, panelId }"}</PaperCode>.</td>
                        <td>A token scoped to the panel. A page served from a paired computer gets a token that only relays through the local daemon.</td>
                    </tr>
                    <tr>
                        <td>Service started by the daemon</td>
                        <td>The environment, read once on first use: <PaperCode>PAPERBOARD_PANEL_ID</PaperCode>, <PaperCode>PAPERCRANE_PANEL_TOKEN</PaperCode>, <PaperCode>PAPERCRANE_PORT</PaperCode>. The daemon also sets <PaperCode>PAPERBOARD_DIR</PaperCode> and removes the host's <PaperCode>PAPERCRANE_TOKEN</PaperCode>.</td>
                        <td>A token scoped to the panel. A service never authenticates as the host.</td>
                    </tr>
                    <tr>
                        <td>Any other Node or Bun script</td>
                        <td>The options passed to <PaperCode>initPaperApi</PaperCode>. With none, the file <PaperCode>$PAPERBOARD_DIR/local/crane.json</PaperCode> (default <PaperCode>~/.paperboard/local/crane.json</PaperCode>), for the <PaperCode>"local"</PaperCode> computer only.</td>
                        <td>Whatever the options or the file hold. <PaperCode>crane.json</PaperCode> holds the host's own token.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A service does not read <PaperCode>crane.json</PaperCode>. A page URL is never read as identity: only the injection counts.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Signature</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>getPanelId</PaperCode></td>
                        <td><PaperCode>() =&gt; string</PaperCode></td>
                        <td>The panel id of this page or service. Returns <PaperCode>""</PaperCode> when there is none, such as a page the host did not serve. Pass it through <PaperCode>requirePanelId</PaperCode> to fail loudly instead.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>grantedComputerId</PaperCode></td>
                        <td><PaperCode>() =&gt; string</PaperCode></td>
                        <td>The computer this page was served for: <PaperCode>"local"</PaperCode> or a paired computer's id. A service gets <PaperCode>"local"</PaperCode>. On a page without the injection it throws <PaperCode>Paperboard computer identity was not injected; initialize an explicit transport</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isPanelId</PaperCode></td>
                        <td><PaperCode>(value: unknown) =&gt; value is string</PaperCode></td>
                        <td>True for a valid, unreserved panel id. See <PaperLink href="/docs/paperapi/manifest/">the manifest</PaperLink> for the rule.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>requirePanelId</PaperCode></td>
                        <td><PaperCode>(value: unknown) =&gt; string</PaperCode></td>
                        <td>Returns the value when it is a valid panel id. Otherwise throws <PaperCode>Invalid panel id: use a lowercase identifier (letters, digits, dots, hyphens, underscores), at most 128 characters; library, settings, landing, app-settings, crane_version, default and shell-* are reserved</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>panelAssetUrl</PaperCode></td>
                        <td><PaperCode>(panelId: string, subpath?: string) =&gt; string</PaperCode></td>
                        <td>The address of a file another panel serves on the same computer, such as its icon. Returns <PaperCode>panel://&lt;computerId&gt;.&lt;panelId&gt;/&lt;subpath&gt;</PaperCode>, or the matching <PaperCode>http</PaperCode> subdomain in browser mode. Throws like <PaperCode>requirePanelId</PaperCode> and <PaperCode>grantedComputerId</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>initPaperApi</PaperCode></td>
                        <td><PaperCode>(opts?: InitOptions) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Creates the transport for <PaperCode>opts.computerId</PaperCode> (default: <PaperCode>grantedComputerId()</PaperCode>) and resolves once it is connected and authenticated. A second call for the same computer reuses the first transport: options passed to it are ignored, with the console warning <PaperCode>[paperapi] initPaperApi called after bootstrap; transport options ignored</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`interface InitOptions {
    port?: number;
    token?: string;
    panelId?: string;
    /** "local" or a paired computer's id */
    computerId?: string;
    /** Node and Bun only: read this handshake file instead of $PAPERBOARD_DIR/local/crane.json */
    craneJsonPath?: string;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="transport">Transport</PaperText>
            <PaperTextList>
                <li>One WebSocket per computer, to <PaperCode>ws://127.0.0.1:&lt;port&gt;</PaperCode>. A paired computer is reached through the local daemon.</li>
                <li>Opening the socket times out after 10 seconds with <PaperCode>PaperCrane connection timed out</PaperCode>.</li>
                <li>A call times out after 30 seconds unless its API says otherwise, with <PaperCode>{"PaperCrane '<action>' timed out"}</PaperCode>. Downloads, installs, uninstalls, backups and restores have no timeout.</li>
                <li>At most 1000 calls wait for an answer at once. The next one throws <PaperCode>PaperCrane transport has 1000 outstanding calls (cap 1000); refusing to queue '&lt;action&gt;'</PaperCode>.</li>
                <li>A dropped socket reconnects with a backoff from 400 milliseconds up to 5 seconds. Registered actions, event subscriptions and process and terminal attachments are restored after it reconnects.</li>
                <li>Every frame carries the credential and the protocol version, exported as <PaperCode>PROTOCOL_VERSION</PaperCode> (2).</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                A refused call rejects with an <PaperCode>Error</PaperCode> whose <PaperCode>message</PaperCode> is the daemon's sentence and whose <PaperCode>code</PaperCode> names the kind of failure.
                Show the message to the person using the panel: the daemon writes it for them.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th><PaperCode>err.code</PaperCode></th>
                        <th>When</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>AUTH_REQUIRED</PaperCode></td><td>The credential is missing, wrong or revoked.</td></tr>
                    <tr><td><PaperCode>BAD_PROTOCOL</PaperCode></td><td>The SDK and the daemon speak different protocol versions.</td></tr>
                    <tr><td><PaperCode>NOT_FOUND</PaperCode></td><td>The action or thing named does not exist, such as <PaperCode>Unknown action: system:nope</PaperCode> or an unclaimed port.</td></tr>
                    <tr><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>An argument breaks a rule: a bad name, a value over a limit, a bad path.</td></tr>
                    <tr><td><PaperCode>FORBIDDEN</PaperCode></td><td>The credential may not do this, such as naming another panel or calling a host-only action.</td></tr>
                    <tr><td><PaperCode>CONFLICT</PaperCode></td><td>The state does not allow it now: a port is taken, no backup location is chosen, an action name is held by another connection.</td></tr>
                    <tr><td><PaperCode>INTERNAL</PaperCode></td><td>Anything else the daemon reports, including refused file paths.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Errors raised by the SDK itself before a call is sent, such as an invalid panel id or a timeout, carry no <PaperCode>code</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { configApi } from "@mileniumhq/paperapi";

try {
    await configApi.get("dev.paperboard.terminal");
} catch (err) {
    // FORBIDDEN: Cross-panel access refused: credential is scoped to
    // dev.example.weather; access is limited to dev.example.weather
    console.error((err as { code?: string }).code, (err as Error).message);
    throw err;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="readiness">Readiness</PaperText>
            <PaperText preset="body" as="p">
                The shell keeps a panel or widget frame covered until the page answers its start-up check, and PaperAPI answers it for you.
                When the frame loads, the shell posts <PaperCode>paperboard:initialize</PaperCode>. PaperAPI then, in order:
            </PaperText>
            <PaperTextList ordered>
                <li>Connects, and calls the service's internal <PaperCode>__getState</PaperCode> action when the manifest names a service.</li>
                <li>On a widget page, mounts the widget the shell asked for.</li>
                <li>Hydrates every <PaperLink href="/docs/paperapi/bridge/">panel bridge</PaperLink> on the page.</li>
                <li>Waits for fonts and images to paint, for at most 4 seconds.</li>
                <li>Posts <PaperCode>paperboard:ready</PaperCode>, or <PaperCode>paperboard:failed</PaperCode> with the error message, which the shell shows.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A panel page that has not answered after 25 seconds is shown as failed with <PaperCode>The panel did not finish connecting to its service.</PaperCode> A page that never imports PaperAPI never answers. The internal action names are exported as <PaperCode>STATE_GET_ACTION</PaperCode>, <PaperCode>STATE_SYNC_EVENT</PaperCode> and <PaperCode>WIDGET_CHOICES_ACTION</PaperCode>.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperapi/permissions/">what a panel credential may do</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
