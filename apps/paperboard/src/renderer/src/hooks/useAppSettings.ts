import { createSignal, createEffect } from "solid-js";
import { config } from "@mileniumhq/paperapi";
import { logToMain, notifyAppSettingsChanged } from "../lib/shell";
import {
    APP_SETTINGS_DEFAULTS,
    APP_SETTINGS_ID,
    type AppSettingsData,
} from "../components/settings/AppSettings";

// App-wide settings: load, mirror reduced motion onto the document, persist
// before notifying main.
export function useAppSettings() {
    const [appSettings, setAppSettings] =
        createSignal<AppSettingsData>(APP_SETTINGS_DEFAULTS);

    // Mirrors the motion preference onto the document for PaperUI tokens
    createEffect(() => {
        if (typeof document !== "undefined") {
            if (appSettings().reducedMotion) {
                document.documentElement.setAttribute(
                    "data-paperui-motion",
                    "reduced",
                );
            } else {
                document.documentElement.removeAttribute(
                    "data-paperui-motion",
                );
            }
        }
    });

    const loadAppSettings = async () => {
        try {
            const stored = await config.get<Partial<AppSettingsData>>(
                APP_SETTINGS_ID,
            );
            if (stored) {
                const merged = { ...APP_SETTINGS_DEFAULTS, ...stored };
                setAppSettings(merged);
            }
        } catch (err) { console.error("[useAppSettings] load failed:", err); }
    };

    const handleAppSettingsChange = async (next: AppSettingsData) => {
        // Persist BEFORE notifying main: main re-reads the file during sync.
        // R3: a failed persist must NOT notify — main would broadcast the
        // stale file while the UI shows the new values, and the states
        // silently diverge until the next load reverts the UI. Re-read
        // from the store instead: the UI falls back to persisted truth.
        try {
            await config.set(next, APP_SETTINGS_ID);
        } catch (err) {
            logToMain("error", "Failed to persist app settings; native side not notified:", err);
            await loadAppSettings();
            return;
        }
        // commit to renderer state: PaperSelectMenu/PaperToggle are controlled
        // (their display follows the value prop), and the theme/motion effects
        // read this signal, so a successful persist must update it or the UI
        // keeps showing the previous selection.
        setAppSettings(next);
        notifyAppSettingsChanged();
    };

    return { appSettings, loadAppSettings, handleAppSettingsChange };
}
