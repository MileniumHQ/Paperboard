import { createSignal, createEffect, on, onCleanup } from "solid-js";
import { config, errorMessage, SerialQueue } from "@mileniumhq/paperapi";
import { showError } from "@mileniumhq/paperui";
import { logToMain, notifyAppSettingsChanged, shellApi } from "../lib/shell";
import { withAppSettingsDefaults } from "../../../shared/appSettingsDefaults";
import { effectiveLook, type Graphics } from "../../../shared/graphics";
import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_ID, type AppSettingsData } from "../lib/appSettings";

const APPLY_FAILED = "Couldn't apply Run on startup";

// App-wide settings: load, mirror reduced motion and blur onto the document, persist
// before notifying main. Settings that didn't load are said as a toast when
// they fail, and stand in App Settings, with Try again, until a load works; a
// save or an apply that fails is a toast.
export function useAppSettings() {
    const [appSettings, setAppSettings] =
        createSignal<AppSettingsData>(APP_SETTINGS_DEFAULTS);
    // why the stored settings couldn't be read: the defaults show, and nothing saves
    const [loadError, setLoadError] = createSignal<string | null>(null);
    // assumed drawn on a GPU until main says otherwise, a moment after start
    const [graphics, setGraphics] = createSignal<Graphics>({ gpu: true });
    const look = () => effectiveLook(appSettings(), graphics());

    onCleanup(shellApi.onGraphicsChanged(setGraphics));
    // said once, on its own: a settings failure later must not hide it
    shellApi.getGraphics().then(setGraphics, (err) => {
        logToMain("error", "Couldn't tell whether Paperboard is drawn on a GPU:", err);
        showError("Graphics card not checked", `Animations and blur stay on unless you turn them off, even if this computer has no graphics card: ${errorMessage(err)}`);
    });

    // Mirrors the motion preference onto the document for PaperUI tokens
    createEffect(on(() => look().disableAnimations, (reduced) => {
        if (typeof document === "undefined") return;
        if (reduced) document.documentElement.setAttribute("data-paperui-motion", "reduced");
        else document.documentElement.removeAttribute("data-paperui-motion");
    }));

    // Mirrors the blur preference the same way
    createEffect(on(() => look().disableBlur, (off) => {
        if (typeof document === "undefined") return;
        if (off) document.documentElement.setAttribute("data-paperui-blur", "off");
        else document.documentElement.removeAttribute("data-paperui-blur");
    }));

    // A change made while a load is out makes the load's answer old news: it
    // was read before the change was saved, and showing it would undo the
    // change on screen (and the next change would be built on it).
    let changes = 0;
    // settings that didn't load are still on disk: a change saved over them
    // would replace every one of them with the defaults showing
    let unread = false;

    /** true when the stored settings were read */
    const loadAppSettings = async (): Promise<boolean> => {
        const asked = changes;
        try {
            const stored = await config.get<Partial<AppSettingsData>>(
                APP_SETTINGS_ID,
            );
            unread = false;
            setLoadError(null);
            if (asked !== changes) return true;
            // nothing saved yet is the defaults, also when a first change didn't save
            setAppSettings(stored ? withAppSettingsDefaults(APP_SETTINGS_DEFAULTS, stored) : APP_SETTINGS_DEFAULTS);
            return true;
        } catch (err) {
            logToMain("error", "Failed to load app settings; showing the defaults:", err);
            unread = true;
            setLoadError(errorMessage(err));
            // said as it happens, wherever the person is; App Settings holds it, with Try again, until a load works
            showError("Couldn't load your settings", `Paperboard is showing the defaults, and changes aren't saved: ${errorMessage(err)}`, {
                retry: () => void loadAppSettings(),
            });
            return false;
        }
    };

    const retryLoadAppSettings = () => void loadAppSettings();

    // A change shows at once, and the next change is built on it: settings
    // that only changed once the save came back would hand a second change,
    // made while the first was saving, the old settings, and its save would
    // undo the first. The saves themselves run one at a time, in order.
    const saves = new SerialQueue();
    const handleAppSettingsChange = (next: AppSettingsData): Promise<void> => {
        if (unread) {
            showError(
                "Couldn't save the change",
                "Your settings didn't load, and saving now would replace them with the defaults. Fix or remove app-settings.json, then load them again from App Settings.",
            );
            return Promise.resolve();
        }
        changes++;
        setAppSettings(next);
        // a save with a newer one waiting behind it knows that one carries its change on
        return saves.run(() => persistAppSettings(next, () => saves.waiting > 0));
    };

    const persistAppSettings = async (next: AppSettingsData, superseded: () => boolean) => {
        // Persist BEFORE notifying main: main re-reads the file during sync.
        // A failed persist must NOT notify — main would broadcast the
        // stale file while the UI shows the new values, and the states
        // silently diverge until the next load reverts the UI.
        try {
            await config.set(next, APP_SETTINGS_ID);
        } catch (err) {
            logToMain("error", "Failed to persist app settings; native side not notified:", err);
            // a newer change is already waiting and carries this one in it:
            // its save tries again, and clears this failure if it lands
            if (superseded()) {
                showError("Couldn't save your settings", err);
                return;
            }
            // Nothing newer: the UI falls back to the persisted truth, and
            // the save's failure is what to show, even if the re-read fails too
            if (await loadAppSettings()) showError("Couldn't save your settings", err);
            else showError("Couldn't save your settings", `${errorMessage(err)}. The saved settings couldn't be read back either.`);
            return;
        }
        await applyAppSettings();
    };

    /** main applies the saved settings to the system (start-up does too);
     * a toast says why it couldn't */
    const applyAppSettings = async (): Promise<void> => {
        try {
            const refused = await notifyAppSettingsChanged();
            if (refused) showError(APPLY_FAILED, refused);
        } catch (err) {
            logToMain("error", "Failed to apply app settings:", err);
            showError(APPLY_FAILED, err);
        }
    };

    return {
        appSettings,
        graphics,
        loadAppSettings,
        applyAppSettings,
        handleAppSettingsChange,
        /** why the stored settings couldn't be read, while they can't */
        loadError,
        retryLoadAppSettings,
    };
}
