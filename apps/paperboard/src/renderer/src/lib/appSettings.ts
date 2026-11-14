// The shell's app-wide settings, as saved in the local daemon's
// "app-settings" document (main reads the same document, appSettings.ts).
import { START_ON_HOME } from "./startOn";

export const APP_SETTINGS_ID = "app-settings";

export interface AppSettingsData {
    darkMode: "system" | "light" | "dark";
    /** absent until chosen: off on a GPU, on without one */
    disableAnimations?: boolean;
    /** absent until chosen, the same way */
    disableBlur?: boolean;
    runOnStartup: boolean;
    /** where Paperboard opens: Home, or a computer's id */
    startOn: string;
}

export const APP_SETTINGS_DEFAULTS: AppSettingsData = {
    darkMode: "system",
    runOnStartup: false,
    startOn: START_ON_HOME,
};
