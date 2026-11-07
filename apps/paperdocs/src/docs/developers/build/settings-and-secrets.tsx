import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const SAVE_SETTINGS = `// The service is the only writer of the settings document: save first, then
// show, so the state never claims something the disk doesn't hold.
async function saveSettings(ctx: Ctx, settings: WeatherSettings): Promise<void> {
    await configApi.set(settings, PANEL_ID);
    ctx.setState({ settings });
}`;

const SET_UNITS = `defineAction({
    id: "set-units",
    name: "Set units",
    description: "Switches between Celsius and Fahrenheit",
    internal: true,
    run: async (ctx: Ctx, inputs: { units?: string }) => {
        if (inputs.units !== "metric" && inputs.units !== "imperial") throw new Error("Units are metric or imperial");
        await saveSettings(ctx, { ...ctx.state.settings, units: inputs.units });
        await refreshAll(ctx);
        return true;
    },
}),`;

const READ_KEY = `async function readKey(): Promise<string> {
    const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
    if (!stored.found || !stored.value) throw new Error("Add an OpenWeather API key in Weather's settings");
    return stored.value;
}`;

const KEY_CHANGED = `defineAction({
    id: "key-changed",
    name: "API key changed",
    description: "Reads the API key again after the settings page saved or removed it",
    internal: true,
    run: async (ctx: Ctx) => {
        const stored = await secretsApi.get(API_KEY_SECRET, PANEL_ID);
        ctx.setState({ hasKey: stored.found });
        await refreshAll(ctx);
        return true;
    },
}),`;

const SETTINGS_PAGE = `import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@mileniumhq/paperui";
import { secretsApi } from "@mileniumhq/paperapi";
import { API_KEY_SECRET, PANEL_ID } from "../panel";
import { bridge, errorMessage, weather } from "../weather";

export default function SettingsPage() {
    const [key, setKey] = createSignal("");
    const [failure, setFailure] = createSignal<{ title: string; message: string } | null>(null);
    const [confirmRemove, setConfirmRemove] = createSignal(false);

    const setUnits = async (units: string | number) => {
        setFailure(null);
        try {
            await bridge.call<boolean>("set-units", { units });
        } catch (err) {
            setFailure({ title: "Units not changed", message: errorMessage(err) });
        }
    };

    const saveKey = async () => {
        setFailure(null);
        try {
            // the key goes to the vault; the service reads it from there
            await secretsApi.set(API_KEY_SECRET, key(), PANEL_ID);
            setKey("");
            await bridge.call<boolean>("key-changed");
        } catch (err) {
            setFailure({ title: "API key not saved", message: errorMessage(err) });
        }
    };

    const removeKey = async () => {
        setConfirmRemove(false);
        setFailure(null);
        try {
            await secretsApi.delete(API_KEY_SECRET, PANEL_ID);
            await bridge.call<boolean>("key-changed");
        } catch (err) {
            setFailure({ title: "API key not removed", message: errorMessage(err) });
        }
    };

    return (
        <PaperPage>
            <PaperPageHeader icon="settings" title="Settings" />
            <Show when={failure()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="warning" title={shown().title} role="alert" onDismiss={() => setFailure(null)}>
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Units" description="How temperatures are shown and sent to flows">
                    <PaperSelectMenu name="units" value={weather().settings.units} onValueChange={(units) => void setUnits(units)}>
                        <PaperSelectMenuItem value="metric">Celsius</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="imperial">Fahrenheit</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem
                    title="OpenWeather API key"
                    description={weather().hasKey ? "Saved on this computer. Enter a new one to replace it." : "Not set"}
                >
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperInput
                            label="API key"
                            type="password"
                            autocomplete="off"
                            value={key()}
                            onInput={(e) => setKey(e.currentTarget.value)}
                        />
                        <PaperButton disabled={!key()} onClick={() => void saveKey()}>
                            Save
                        </PaperButton>
                        <Show when={weather().hasKey}>
                            <PaperButton variant="danger" onClick={() => setConfirmRemove(true)}>
                                Remove
                            </PaperButton>
                        </Show>
                    </PaperFlex>
                </PaperSettingItem>
            </PaperSettingList>
            <PaperModal
                open={confirmRemove()}
                onClose={() => setConfirmRemove(false)}
                title="Remove the API key"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setConfirmRemove(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" onClick={() => void removeKey()}>
                            Remove
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body" as="p">
                    Weather stops checking the weather until you add a key again.
                </PaperText>
            </PaperModal>
        </PaperPage>
    );
}`;

export default function SettingsAndSecretsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Settings and secrets</PaperText>
            <PaperText preset="body" as="p">
                A panel saves its settings with configApi and keeps API keys, tokens and passwords apart in secretsApi.
                This guide builds the Weather example panel's settings page: units saved as a setting, and an OpenWeather API key saved as a secret.
                At the end, the settings survive a restart and the key is never in the state, the settings or a backup.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel with a service, as in <PaperLink href="/docs/developers/services/">Services and state</PaperLink>.
                The exact calls are in the <PaperLink href="/docs/paperapi/config/">configApi</PaperLink> and <PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink> references.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="which-one">Setting or secret</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th></th>
                        <th>configApi</th>
                        <th>secretsApi</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Holds</td><td>Any JSON document: choices, lists, the panel's records</td><td>Named strings: API keys, tokens, passwords</td></tr>
                    <tr><td>Stored at</td><td><PaperCode>configs/&lt;panel-id&gt;.json</PaperCode> in the data folder</td><td><PaperCode>local/secrets.json</PaperCode> in the data folder, readable only by the account running Paperboard</td></tr>
                    <tr><td>Backups</td><td>Included</td><td>Never included</td></tr>
                    <tr><td>Other computers</td><td>Restored with a backup</td><td>Set again on each computer</td></tr>
                    <tr><td>Weather keeps</td><td>The followed cities and the units</td><td>The OpenWeather API key</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The secrets file is plain JSON, not encrypted. It protects a key from other accounts on the computer and keeps it out of backups, config and file reads. Anyone signed in as the same account can read it.
                Never write a secret to config, to the panel's files, or to the log.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="settings">Save settings from the service</PaperText>
            <PaperText preset="body" as="p">
                Keep one writer for the settings document, the service. Two writers that each read, change and save the document overwrite each other's changes, because <PaperCode>configApi.set</PaperCode> replaces the whole document.
                Weather's service saves through one function:
            </PaperText>
            <PaperCode block language="tsx">{SAVE_SETTINGS}</PaperCode>
            <PaperText preset="body" as="p">
                The page changes a setting by calling an internal action, which checks the value before it saves:
            </PaperText>
            <PaperCode block language="tsx">{SET_UNITS}</PaperCode>
            <PaperTextList>
                <li><PaperCode>internal: true</PaperCode> keeps the action out of the Actions panel's library and the Agent panel, and refuses it to other panels. The panel's own pages still call it. See <PaperLink href="/docs/developers/actions/#internal">Expose actions</PaperLink>.</li>
                <li><PaperCode>configApi.get</PaperCode> resolves with <PaperCode>null</PaperCode> before the first save. Weather starts from <PaperCode>{"{ ...DEFAULT_SETTINGS, ...saved }"}</PaperCode> in <PaperCode>onInit</PaperCode>, so a setting added in a later version gets its default.</li>
                <li>Settings are in the state, so every window shows the current value without asking.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="secrets">Keep the key a secret</PaperText>
            <PaperText preset="body" as="p">
                The page saves the key with <PaperCode>secretsApi.set</PaperCode> and tells the service it changed. The service reads it each time it needs it:
            </PaperText>
            <PaperCode block language="tsx">{READ_KEY}</PaperCode>
            <PaperCode block language="tsx">{KEY_CHANGED}</PaperCode>
            <PaperTextList>
                <li>The state holds <PaperCode>hasKey</PaperCode>, never the key. Every page and widget of the panel receives the state.</li>
                <li>The key never travels as an action input or result, so the page never sends it to the service and nothing that calls an action sees it.</li>
                <li>A missing key is a failure with the fix in it: <PaperCode>Add an OpenWeather API key in Weather's settings</PaperCode>. It shows on every city until a key is saved.</li>
                <li><PaperCode>paperapi monitor</PaperCode> prints the secret's name, never its value.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="the-page">The settings page</PaperText>
            <PaperText preset="body" as="p">
                Weather's <PaperCode>src/pages/SettingsPage.tsx</PaperCode>, with the units, the key, and a confirm before the key is removed:
            </PaperText>
            <PaperCode block language="tsx">{SETTINGS_PAGE}</PaperCode>
            <PaperTextList>
                <li>The key field is <PaperCode>type="password"</PaperCode> with <PaperCode>autocomplete="off"</PaperCode>, and it is cleared once the key is saved. The page never shows a saved key again. It says the key is saved and offers to replace or remove it.</li>
                <li>Each failure names what didn't happen, such as <PaperCode>API key not saved</PaperCode>, with the reason below.</li>
                <li>The confirm modal is explained in <PaperLink href="/docs/developers/ui/#confirm">Design the interface</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="removal">When the panel is removed</PaperText>
            <PaperText preset="body" as="p">
                Uninstalling a panel keeps its config, files and secrets, so installing it again picks up where the person left off.
                They are deleted only when the person turns on <b>Also delete this panel's data and saved credentials</b> as they uninstall it. Never delete them yourself when the panel stops or updates.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="check-it">Check it</PaperText>
            <PaperCode block language="sh">
{`bunx paperapi call dev.example.weather set-units '{"units":"imperial"}'
bunx paperapi restart
bunx paperapi call dev.example.weather __getState`}
            </PaperCode>
            <PaperText preset="body" as="p">
                After the restart, <PaperCode>settings.units</PaperCode> is still <PaperCode>imperial</PaperCode> and <PaperCode>hasKey</PaperCode> says whether a key is saved. The key itself appears nowhere in the output.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/actions/">expose actions</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
