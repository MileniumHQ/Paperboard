import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ConfigApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">configApi</PaperText>
            <PaperText preset="body" as="p">
                configApi saves a panel's settings and other small JSON data on the computer the panel runs on.
                It works on a panel page, in a widget and in a service, and every one of them reads the same documents.
                Keep passwords and tokens out of it: those go in <PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { configApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

interface WeatherSettings {
    cities: string[];
    units: "metric" | "imperial";
}

const saved = await configApi.get<WeatherSettings>(PANEL_ID);
const settings: WeatherSettings = saved ?? { cities: [], units: "metric" };

await configApi.set({ ...settings, cities: [...settings.cities, "Lisbon"] }, PANEL_ID);`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`configApi.get<T = any>(id: string, path?: string, scope?: string): Promise<T | null>;
configApi.set(data: any, id: string, path?: string, scope?: string): Promise<true>;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>The panel id the document belongs to.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>data</PaperCode></td>
                        <td>Any JSON value</td>
                        <td>Required</td>
                        <td>The whole new document. At most 1 MiB once serialized.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>path</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (the panel's main document)</td>
                        <td>A second document, such as <PaperCode>tabs.json</PaperCode> or <PaperCode>layouts/home.json</PaperCode>. It ends in <PaperCode>.json</PaperCode>, is relative, has no <PaperCode>..</PaperCode> or empty parts, and is at most 256 characters.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scope</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The computer the document was granted</td>
                        <td>The computer to read or write on. See <PaperLink href="/docs/paperapi/connection/">Connection and identity</PaperLink>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li><PaperCode>get</PaperCode> resolves with <PaperCode>null</PaperCode> when the document was never saved. Choose the starting value in the panel, as the sample does.</li>
                <li><PaperCode>set</PaperCode> replaces the whole document. It does not merge, so read, change and write back the complete value.</li>
                <li>The main document is stored at <PaperCode>configs/&lt;id&gt;.json</PaperCode> in the Paperboard data folder, and a <PaperCode>path</PaperCode> document at <PaperCode>files/&lt;id&gt;/&lt;path&gt;</PaperCode>, beside the panel's <PaperLink href="/docs/paperapi/file/">files</PaperLink>. Each write replaces the file in one step, so a crash never leaves half a document.</li>
                <li>Two writers at once: the last <PaperCode>set</PaperCode> wins. Keep one owner for each document, usually the service.</li>
                <li>Backups include both kinds of document. See <PaperLink href="/docs/paperapi/backups/">backupApi</PaperLink>.</li>
                <li>A panel reads and writes only its own id. Another id is refused.</li>
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
                    <tr><td><PaperCode>config calls need an explicit config id (usually your panel id)</PaperCode></td><td>No code</td><td><PaperCode>id</PaperCode> is missing or empty. Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>Invalid config path: "&lt;path&gt;"</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A path outside the rules above.</td></tr>
                    <tr><td><PaperCode>Config "&lt;id&gt;" exceeds 1048576 byte payload cap</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>The document is over 1 MiB.</td></tr>
                    <tr><td><PaperCode>Cross-panel access refused: credential is scoped to "&lt;panel&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>The id is another panel's.</td></tr>
                    <tr><td>A JSON parse error</td><td><PaperCode>INTERNAL</PaperCode></td><td>The file on disk is not valid JSON, such as one edited by hand.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
