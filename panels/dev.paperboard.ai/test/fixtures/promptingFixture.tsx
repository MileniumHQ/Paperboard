// Interactive browser fixture for the real prompting controls. Service persistence
// and model transport are covered separately in app.test.ts and chat.test.ts.
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { createStore } from "solid-js/store";
import { PaperProvider, PaperText } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import PromptingSettings from "../../src/components/PromptingSettings";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/types";
import { systemPrompt } from "../../src/core/conversation";
import { saveSettings } from "../../src/core/saveSettings";

const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, defaultModel: "qwen3:8b" });
let serviceSettings: Settings = { ...settings };
const [error, setError] = createSignal("");
render(() => <PaperProvider><main style={{ padding: "var(--paper-uigap)", display: "flex", "flex-direction": "column", gap: "var(--paper-uigap)" }}>
    <Show when={error()}><PaperText role="alert">{error()}</PaperText></Show>
    <PromptingSettings settings={settings} save={async (patch) => {
        setError("");
        try {
            await saveSettings(patch, {
                update: async (patch) => {
                    if (new URLSearchParams(location.search).has("legacy")) return serviceSettings;
                    if (patch.customPromptEnabled && serviceSettings.customSystemPrompt === null) {
                        patch.customSystemPrompt = systemPrompt({ style: serviceSettings.promptStyle, model: serviceSettings.defaultModel, webSearch: true, shellCommands: true, panelActions: false });
                    }
                    serviceSettings = { ...serviceSettings, ...patch };
                    return serviceSettings;
                },
                // Intentionally no state event: the same save path as SettingsView refreshes.
                refresh: async () => { setSettings(serviceSettings); },
            });
            return true;
        } catch (error) {
            setError(String(error));
            return false;
        }
    }} />
</main></PaperProvider>, document.getElementById("app")!);
