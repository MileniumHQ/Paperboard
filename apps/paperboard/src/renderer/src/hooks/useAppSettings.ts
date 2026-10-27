import { createSignal, createEffect } from "solid-js";
import { config } from "@mileniumhq/paperapi";
import { logToMain, notifyAppSettingsChanged } from "../lib/shell";
import {
    APP_SETTINGS_DEFAULTS,
    APP_SETTINGS_ID,
    type AppSettingsData,
} from "../components/settings/AppSettings";

export interface SettingsFailure {
    /** which way it failed: settings that didn't load leave the defaults showing */
    kind: "load" | "save";
    message: string;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// App-wide settings: load, mirror reduced motion onto the document, persist
// before notifying main. A load or save that fails stays as a failure for
// App Settings to show, until it's retried or dismissed.
export function useAppSettings() {
    const [appSettings, setAppSettings] =
        createSignal<AppSettingsData>(APP_SETTINGS_DEFAULTS);
    const [settingsFailure, setSettingsFailure] = createSignal<SettingsFailure | null>(null);

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

    /** true when the stored settings were read */
    const loadAppSettings = async (): Promise<boolean> => {
        try {
            const stored = await config.get<Partial<AppSettingsData>>(
                APP_SETTINGS_ID,
            );
            if (stored) {
                const merged = { ...APP_SETTINGS_DEFAULTS, ...stored };
                setAppSettings(merged);
            }
            return true;
        } catch (err) {
            logToMain("error", "Failed to load app settings; showing the defaults:", err);
            setSettingsFailure({ kind: "load", message: messageOf(err) });
            return false;
        }
    };

    const retryLoadAppSettings = async () => {
        setSettingsFailure(null);
        await loadAppSettings();
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
            // the save's failure is what to show, even if the re-read fails too
            if (await loadAppSettings()) setSettingsFailure({ kind: "save", message: messageOf(err) });
            else setSettingsFailure({ kind: "save", message: `${messageOf(err)}. The saved settings couldn't be read back either.` });
            return;
        }
        if (settingsFailure()?.kind === "save") setSettingsFailure(null);
        // commit to renderer state: PaperSelectMenu/PaperToggle are controlled
        // (their display follows the value prop), and the theme/motion effects
        // read this signal, so a successful persist must update it or the UI
        // keeps showing the previous selection.
        setAppSettings(next);
        notifyAppSettingsChanged();
    };

    return {
        appSettings,
        loadAppSettings,
        handleAppSettingsChange,
        settingsFailure,
        retryLoadAppSettings,
        dismissSettingsFailure: () => setSettingsFailure(null),
    };
}
