import {
    PaperSettingList,
    PaperSettingItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperToggle,
    PaperEffect,
    PaperButton,
    PaperIcon,
} from "@paperboard-dev/paperui";
import { Show } from "solid-js";
import { isBrowserShell, shellIpc } from "../../lib/shell";

export interface AppSettingsData {
    darkMode: "system" | "light" | "dark";
    reducedMotion: boolean;
    runOnStartup: boolean;
}

export const APP_SETTINGS_DEFAULTS: AppSettingsData = {
    darkMode: "system",
    reducedMotion: false,
    runOnStartup: false,
};

export const APP_SETTINGS_ID = "app-settings";

export default function AppSettings(props: {
    settings: AppSettingsData;
    onChange: (next: AppSettingsData) => void;
}) {
    const handleChange = (next: Record<string, any>) => {
        props.onChange({ ...props.settings, ...next });
    };

    return (
        <PaperSettingList
            flat
            value={{ ...props.settings } as Record<string, any>}
            onValueChange={handleChange}
            style={{
                height: "100%"
            }}
        >
            <PaperSettingItem
                title="Appearance"
                description="Match the operating system appearance or force light or dark."
            >
                <PaperSelectMenu
                    name="darkMode"
                    value={props.settings.darkMode}
                    fullWidth
                >
                    <PaperSelectMenuItem value="system" icon="contrast">
                        System
                    </PaperSelectMenuItem>
                    <PaperSelectMenuItem value="light" icon="light_mode">
                        Light
                    </PaperSelectMenuItem>
                    <PaperSelectMenuItem value="dark" icon="dark_mode">
                        Dark
                    </PaperSelectMenuItem>
                </PaperSelectMenu>
            </PaperSettingItem>

            <PaperSettingItem
                title="Reduce motion"
                description="Disables animations, transitions, and blur effects for better performance and accessibility."
            >
                <PaperToggle
                    name="reducedMotion"
                    checked={props.settings.reducedMotion}
                />
            </PaperSettingItem>

            <PaperSettingItem
                title="Run on startup"
                description="Launch Paperboard automatically when you log in."
            >
                <PaperToggle
                    name="runOnStartup"
                    checked={props.settings.runOnStartup}
                />
            </PaperSettingItem>

            {/* browser mode has no updater window to restart into */}
            <Show when={!isBrowserShell()}>
            <PaperSettingItem
                title="Updates"
                description="Runs a full update sweep right now: every panel, package, and Paperboard Server daemon on every connected computer is checked and updated, then Paperboard restarts."
            >
                <PaperEffect variant="primary">
                    <PaperButton
                        onClick={() =>
                            shellIpc().send("relaunch-for-update")
                        }>
                        <PaperIcon>restart_alt</PaperIcon>
                        Update everything now
                    </PaperButton>
                </PaperEffect>
            </PaperSettingItem>
            </Show>
        </PaperSettingList>
    );
}
