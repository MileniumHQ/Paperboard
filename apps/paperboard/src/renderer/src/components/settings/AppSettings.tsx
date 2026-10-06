import { createSignal, Show } from "solid-js";
import {
    PaperSettingList,
    PaperSettingItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperToggle,
    PaperEffect,
    PaperButton,
    PaperIcon,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperText,
} from "@mileniumhq/paperui";
import { isBrowserShell, shellIpc } from "../../lib/shell";
// Inlined at build time: the viewer always shows the exact files shipped
// in this repo, so the text cannot drift from the license on disk.
import paperboardLicenseText from "../../../../../LICENSE?raw";
import mitLicenseText from "../../../../../../../packages/paperui/LICENSE?raw";

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

type LicenseKind = "paperboard" | "mit";

const LICENSE_TITLES: Record<LicenseKind, string> = {
    paperboard: "PolyForm Noncommercial 1.0.0",
    mit: "MIT license",
};

const LICENSE_TEXTS: Record<LicenseKind, string> = {
    paperboard: paperboardLicenseText,
    mit: mitLicenseText,
};

export default function AppSettings(props: {
    settings: AppSettingsData;
    onChange: (next: AppSettingsData) => void;
}) {
    const [license, setLicense] = createSignal<LicenseKind | null>(null);

    const handleChange = (next: Record<string, any>) => {
        props.onChange({ ...props.settings, ...next });
    };

    return (
        <PaperPage>
            <PaperPageHeader
                icon="settings"
                title="App Settings"
                subtitle="Appearance, startup, updates, and licenses."
            />

            <PaperSettingList
                autoHeight
                value={{ ...props.settings } as Record<string, any>}
                onValueChange={handleChange}
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
                        description="Runs a full update sweep right now: every panel, package, and Paperboard server daemon on every connected computer is checked and updated, then Paperboard restarts."
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

                    <PaperSettingItem
                        title="Quit App"
                        description="Fully exits Paperboard. Your panel services keep running on their computers; reopen Paperboard to connect again."
                    >
                        <PaperButton
                            variant="danger"
                            onClick={() => shellIpc().send("quit-app")}
                            aria-label="Quit Paperboard"
                        >
                            <PaperIcon>close</PaperIcon>
                            Quit App
                        </PaperButton>
                    </PaperSettingItem>
                </Show>
            </PaperSettingList>

            <PaperText preset="subtitle">Licenses</PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="PolyForm Noncommercial 1.0.0"
                    description="Your Paperboard experience"
                >
                    <PaperButton
                        size="small"
                        onClick={() => setLicense("paperboard")}
                        aria-label="View PolyForm Noncommercial 1.0.0 license"
                    >
                        View
                    </PaperButton>
                </PaperSettingItem>
                <PaperSettingItem title="MIT license" description="Applies to SDKs">
                    <PaperButton
                        size="small"
                        onClick={() => setLicense("mit")}
                        aria-label="View MIT license"
                    >
                        View
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal
                open={license() !== null}
                onClose={() => setLicense(null)}
                title={license() ? LICENSE_TITLES[license()!] : ""}
                size="large"
            >
                <Show when={license()}>
                    <PaperText
                        as="pre"
                        family="code"
                        size={2}
                        style={{ "white-space": "pre-wrap", margin: 0 }}
                    >
                        {LICENSE_TEXTS[license()!]}
                    </PaperText>
                </Show>
            </PaperModal>
        </PaperPage>
    );
}
