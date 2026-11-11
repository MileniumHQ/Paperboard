import { createSignal, createEffect, onCleanup } from "solid-js";
import { config } from "@mileniumhq/paperapi";
import { logToMain, notifyAppSettingsChanged, shellApi } from "../lib/shell";
import { withAppSettingsDefaults } from "../../../shared/appSettingsDefaults";
import { effectiveLook, type Graphics } from "../../../shared/graphics";
import {
    APP_SETTINGS_DEFAULTS,
    APP_SETTINGS_ID,
    type AppSettingsData,
} from "../components/settings/AppSettings";

export interface SettingsFailure {
    /** which way it failed: settings that didn't load leave the defaults
     * showing; saved settings the system wouldn't apply are "apply";
     * "graphics" is not knowing whether Paperboard is drawn on a GPU */
    kind: "load" | "save" | "apply" | "graphics";
    message: string;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// App-wide settings: load, mirror reduced motion and blur onto the document, persist
// before notifying main. A load or save that fails stays as a failure for
// App Settings to show, until it's retried or dismissed.
export function useAppSettings() {
    const [appSettings, setAppSettings] =
        createSignal<AppSettingsData>(APP_SETTINGS_DEFAULTS);
    const [settingsFailure, setSettingsFailure] = createSignal<SettingsFailure | null>(null);
    // assumed drawn on a GPU until main says otherwise, a moment after start
    const [graphics, setGraphics] = createSignal<Graphics>({ gpu: true });
    const look = () => effectiveLook(appSettings(), graphics());

    onCleanup(shellApi.onGraphicsChanged(setGraphics));
    shellApi.getGraphics().then(setGraphics, (err) => {
        logToMain("error", "Couldn't tell whether Paperboard is drawn on a GPU:", err);
        setSettingsFailure({ kind: "graphics", message: messageOf(err) });
    });

    // Mirrors the motion preference onto the document for PaperUI tokens
    createEffect(() => {
        if (typeof document !== "undefined") {
            if (look().reducedMotion) {
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

    // Mirrors the blur preference the same way
    createEffect(() => {
        if (typeof document === "undefined") return;
        if (look().disableBlur) document.documentElement.setAttribute("data-paperui-blur", "off");
        else document.documentElement.removeAttribute("data-paperui-blur");
    });

    /** true when the stored settings were read */
    const loadAppSettings = async (): Promise<boolean> => {
        try {
            const stored = await config.get<Partial<AppSettingsData>>(
                APP_SETTINGS_ID,
            );
            if (stored) {
                const merged = withAppSettingsDefaults(APP_SETTINGS_DEFAULTS, stored);
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
        try {
            const refused = await notifyAppSettingsChanged();
            if (refused) setSettingsFailure({ kind: "apply", message: refused });
            else if (settingsFailure()?.kind === "apply") setSettingsFailure(null);
        } catch (err) {
            logToMain("error", "Failed to apply app settings:", err);
            setSettingsFailure({ kind: "apply", message: messageOf(err) });
        }
    };

    return {
        appSettings,
        graphics,
        loadAppSettings,
        handleAppSettingsChange,
        settingsFailure,
        retryLoadAppSettings,
        dismissSettingsFailure: () => setSettingsFailure(null),
    };
}
