import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function ConfigApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Config API</PaperText>
            <PaperText preset="body">
                configApi persists panel configuration documents and workspace JSON files through the host daemon.
                Reach for configApi when saving user preferences, workspace tab layouts, or cached settings.
                The service isolates files by panel identity and performs atomic JSON writes.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import configApi or config from @paperboard-dev/paperapi.
                Call get and set to retrieve and store JSON data.
            </PaperText>
            <PaperCode block language="tsx">
{`import { configApi } from "@paperboard-dev/paperapi";

interface UserPreferences {
    theme: string;
    refreshInterval: number;
}

// Persist settings for the current panel
await configApi.set({ theme: "dark", refreshInterval: 5000 });

// Read stored settings
const prefs = await configApi.get<UserPreferences>();`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module exposes the following configuration functions:
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
                        <td><PaperCode>get</PaperCode></td>
                        <td><PaperCode>get&lt;T&gt;(id?, path?, scope?): Promise&lt;T&gt;</PaperCode></td>
                        <td>Reads stored JSON data. Defaults to the current panel ID and root config file.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>set</PaperCode></td>
                        <td><PaperCode>set(data, id?, path?, scope?): Promise&lt;void&gt;</PaperCode></td>
                        <td>Writes JSON data to the target document.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fetchRegistryIndex</PaperCode></td>
                        <td><PaperCode>fetchRegistryIndex(timeoutMs?, maxBytes?): Promise&lt;Record&lt;string, any&gt;&gt;</PaperCode></td>
                        <td>Fetches the public registry index with bounded download size limits.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When path is omitted, configApi reads configs/{"<panelId>"}.json.
                When a path parameter is supplied (such as "tabs.json"), data writes to files/{"<panelId>"}/{"<path>"}.
                All stored values must serialize to valid JSON.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Store multi-document workspace data using the relative path argument.
            </PaperText>
            <PaperCode block language="tsx">
{`// Persist distinct layout state without overwriting root config
await configApi.set({ openTabs: ["home", "logs"] }, undefined, "workspace.json");`}
            </PaperCode>
        </PaperFlex>
    );
}
