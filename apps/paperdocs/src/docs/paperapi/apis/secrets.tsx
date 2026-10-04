import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function SecretsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Secrets API</PaperText>
            <PaperText preset="body">
                secretsApi stores and accesses sensitive credentials in the encrypted Paperboard daemon vault.
                Reach for secretsApi when storing API keys, bot tokens, personal passwords, or authentication secrets.
                Credentials require explicit panel identity and are isolated from normal file browsing and DAV interfaces.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import secretsApi or secrets from @paperboard-dev/paperapi.
                Always supply the explicit panelId parameter when storing, retrieving, or deleting secrets.
            </PaperText>
            <PaperCode block language="tsx">
{`import { secretsApi } from "@paperboard-dev/paperapi";

const PANEL_ID = "dev.paperboard.my-panel";

// Store a sensitive API key in the daemon vault
await secretsApi.set("api_token", "secret_key_12345", PANEL_ID);

// Retrieve the token
const secret = await secretsApi.get("api_token", PANEL_ID);
if (secret.found) {
    console.log("Token retrieved successfully");
}`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The vault provides the following credential methods:
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
                        <td><PaperCode>set</PaperCode></td>
                        <td><PaperCode>set(name, value, panelId): Promise&lt;void&gt;</PaperCode></td>
                        <td>Encrypted write of a secret string to the vault under the named key.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>get</PaperCode></td>
                        <td><PaperCode>get(name, panelId): Promise&lt;SecretResult&gt;</PaperCode></td>
                        <td>Retrieves a secret. Returns {"{ found: boolean; value: string | null }"}.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>delete</PaperCode></td>
                        <td><PaperCode>delete(name, panelId): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Removes the secret matching the name and panel identity.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>list(panelId?): Promise&lt;string[]&gt;</PaperCode></td>
                        <td>Returns secret names only, for the named panel (or the calling panel by token claim). Never returns secret values and never spans panels.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>purge</PaperCode></td>
                        <td><PaperCode>purge(panelId): Promise&lt;number&gt;</PaperCode></td>
                        <td>Deletes all secrets belonging to the designated panel. Returns deleted count.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                panelId is mandatory for all secret mutations; no ambient or hostname fallback is permitted.
                Listing secrets returns key names only, protecting credential values from unintended logging.
                Vault recovery remains owner-only and inaccessible through WebDAV or general file routes.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                List registered secret names to verify configuration readiness.
            </PaperText>
            <PaperCode block language="tsx">
{`const keys = await secretsApi.list("dev.paperboard.my-panel");
console.log("Configured secret names:", keys);`}
            </PaperCode>
        </PaperFlex>
    );
}
