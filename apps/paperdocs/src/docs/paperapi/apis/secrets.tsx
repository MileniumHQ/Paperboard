import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function SecretsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">secretsApi</PaperText>
            <PaperText preset="body" as="p">
                secretsApi keeps a panel's API keys, tokens and passwords apart from its settings, where backups, sync and other panels can't read them.
                It works on a panel page, in a widget and in a service.
                Store every credential a panel holds here, never in <PaperLink href="/docs/paperapi/config/">configApi</PaperLink> or a file.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { secretsApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

// from the settings page, when the person saves their key
await secretsApi.set("apiKey", key, PANEL_ID);

// in the service, before using it
const stored = await secretsApi.get("apiKey", PANEL_ID);
if (!stored.found) throw new Error("Add an API key in the Weather panel first");
const response = await fetch(url, { headers: { Authorization: \`Bearer \${stored.value}\` } });`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`secretsApi.set(name: string, value: string, panelId: string): Promise<true>;
secretsApi.get(name: string, panelId: string): Promise<{ found: boolean; value: string | null }>;
/** true when there was a secret to delete */
secretsApi.delete(name: string, panelId: string): Promise<boolean>;
secretsApi.list(panelId: string): Promise<string[]>;
/** deletes every secret of the panel; resolves with how many */
secretsApi.purge(panelId: string): Promise<number>;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Value</th>
                        <th>Rule</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>name</PaperCode></td><td>1 to 64 letters, digits, <PaperCode>.</PaperCode>, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>.</td></tr>
                    <tr><td><PaperCode>value</PaperCode></td><td>A string of 1 to 8192 characters. Store a structured credential as JSON text.</td></tr>
                    <tr><td><PaperCode>panelId</PaperCode></td><td>Required on every call, and only the caller's own panel id.</td></tr>
                    <tr><td>Count</td><td>At most 64 secrets for each panel. Replacing an existing name does not count again.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>list</PaperCode> resolves with the names the panel set, sorted, such as <PaperCode>apiKey</PaperCode>.
                It never returns values.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="storage">Storage</PaperText>
            <PaperTextList>
                <li>Secrets live in one file, <PaperCode>local/secrets.json</PaperCode> in the Paperboard data folder, readable only by the account that runs the daemon (mode <PaperCode>0600</PaperCode> on Linux and macOS).</li>
                <li>The file is plain JSON and is not encrypted. Anyone signed in as that account, or with the disk, can read it.</li>
                <li>The daemon keeps it out of backups and refuses it over WebDAV. Config reads and file reads can't reach it.</li>
                <li>Uninstalling a panel keeps its secrets, unless the uninstall deletes the panel's data, which purges them.</li>
                <li>A secret lives on the computer it was set on. Set it again on each computer the panel runs on.</li>
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
                    <tr><td><PaperCode>[paperapi] secrets API requires a non-empty string secret name</PaperCode></td><td>No code</td><td>A missing name, or a missing <PaperCode>panelId</PaperCode> (<PaperCode>... string panelId</PaperCode>). Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>Invalid secret name: "&lt;name&gt;"</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td><PaperCode>set</PaperCode> with a name outside the rule. <PaperCode>get</PaperCode> and <PaperCode>delete</PaperCode> answer not found instead.</td></tr>
                    <tr><td><PaperCode>Secret value must be a non-empty string</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>An empty value. To remove a secret, call <PaperCode>delete</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Secret exceeds 8192 character limit</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A long value.</td></tr>
                    <tr><td><PaperCode>Secret vault full for &lt;panel&gt; (64 entries). Delete one before adding another.</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A 65th name.</td></tr>
                    <tr><td><PaperCode>Cross-panel access refused: credential is scoped to "&lt;panel&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>Another panel's id.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
