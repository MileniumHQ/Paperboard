import { createSignal, createEffect } from "solid-js";
import { config } from "@paperboard-dev/paperapi";
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
            if (stored) setAppSettings({ ...APP_SETTINGS_DEFAULTS, ...stored });
        } catch {}
    };

    const handleAppSettingsChange = async (next: AppSettingsData) => {
        setAppSettings(next);
        // Persist BEFORE notifying main: main re-reads the file during sync
        try {
            await config.set(next, APP_SETTINGS_ID);
        } catch (err) {
            logToMain("error", "Failed to persist app settings:", err);
        }
        notifyAppSettingsChanged();
    };

    return { appSettings, loadAppSettings, handleAppSettingsChange };
}
