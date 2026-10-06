// Interactive browser fixture for the real prompting controls. Service persistence
// and model transport are covered separately in app.test.ts and chat.test.ts.
import { render } from "solid-js/web";
import { createStore } from "solid-js/store";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import PromptingSettings from "../../src/components/PromptingSettings";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/types";
import { systemPrompt } from "../../src/core/conversation";

const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, defaultModel: "qwen3:8b" });
render(() => <PaperProvider><main style={{ padding: "var(--paper-uigap)", display: "flex", "flex-direction": "column", gap: "var(--paper-uigap)" }}>
    <PromptingSettings settings={settings} save={async (patch) => {
        if (patch.customPromptEnabled && settings.customSystemPrompt === null) {
            patch.customSystemPrompt = systemPrompt({ style: settings.promptStyle, model: settings.defaultModel, webSearch: true, shellCommands: true, panelActions: false });
        }
        setSettings(patch);
        return true;
    }} />
</main></PaperProvider>, document.getElementById("app")!);
