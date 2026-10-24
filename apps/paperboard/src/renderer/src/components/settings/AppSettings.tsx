import { createSignal, type JSX, Show } from "solid-js";
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
import styles from "./AppSettings.module.css";
// Inlined at build time: the viewer always shows the exact files shipped
// in this repo, so the text cannot drift from the license on disk.
import paperboardLicenseText from "../../../../../LICENSE?raw";
import mitLicenseText from "../../../../../../../packages/paperui/LICENSE?raw";

export interface AppSettingsData {
    darkMode: "system" | "light" | "dark";
    reducedMotion: boolean;
    runOnStartup: boolean;
    /** buzz on taps, holds, and swipes, on a device that can */
    haptics: boolean;
}

export const APP_SETTINGS_DEFAULTS: AppSettingsData = {
    darkMode: "system",
    reducedMotion: false,
    runOnStartup: false,
    haptics: true,
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

const UPDATE_NOTE = "Updates every panel, package, and computer, then restarts Paperboard.";
const QUIT_NOTE = "Panels keep running on their computers.";

const updateEverything = () => shellIpc().send("relaunch-for-update");
const quitApp = () => shellIpc().send("quit-app");

export default function AppSettings(props: {
    settings: AppSettingsData;
    onChange: (next: AppSettingsData) => void;
    /** reopens Paperboard's own tutorial */
    onShowTutorial: () => void;
    /** the phone layout: grouped rows, the way phones lay out settings */
    compact?: boolean;
}) {
    const [license, setLicense] = createSignal<LicenseKind | null>(null);

    const handleChange = (next: Record<string, any>) => {
        props.onChange({ ...props.settings, ...next });
    };

    const licenseModal = () => (
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
    );

    if (props.compact) {
        return (
            <CompactSettings
                settings={props.settings}
                onChange={handleChange}
                onShowTutorial={props.onShowTutorial}
                onViewLicense={setLicense}
                licenseModal={licenseModal()}
            />
        );
    }

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

                <PaperSettingItem
                    title="Tutorial"
                    description="Walk through what Paperboard can do again."
                >
                    <PaperButton onClick={props.onShowTutorial}>
                        <PaperIcon>school</PaperIcon>
                        Show tutorial
                    </PaperButton>
                </PaperSettingItem>

                {/* browser mode has no updater window to restart into */}
                <Show when={!isBrowserShell()}>
                    <PaperSettingItem
                        title="Updates"
                        description={UPDATE_NOTE}
                    >
                        <PaperEffect variant="primary">
                            <PaperButton
                                onClick={updateEverything}>
                                <PaperIcon>restart_alt</PaperIcon>
                                Update everything now
                            </PaperButton>
                        </PaperEffect>
                    </PaperSettingItem>

                    <PaperSettingItem
                        title="Quit App"
                        description={QUIT_NOTE}
                    >
                        <PaperButton
                            variant="danger"
                            onClick={quitApp}
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

            {licenseModal()}
        </PaperPage>
    );
}

// The phone layout: titled groups of one-line rows, controls on the right,
// actions as rows you tap, and the longer explanations under their group.
function CompactSettings(props: {
    settings: AppSettingsData;
    onChange: (next: Record<string, any>) => void;
    onShowTutorial: () => void;
    onViewLicense: (kind: LicenseKind) => void;
    licenseModal: JSX.Element;
}) {
    const ActionRow = (row: { label: string; onClick: () => void; tone?: "primary" | "danger"; chevron?: boolean }) => (
        <button
            type="button"
            class={styles.row}
            classList={{ [styles.primary]: row.tone === "primary", [styles.danger]: row.tone === "danger" }}
            onClick={row.onClick}
        >
            <span class={styles.label}>{row.label}</span>
            <Show when={row.chevron}>
                <PaperIcon class={styles.chevron} aria-hidden="true">chevron_right</PaperIcon>
            </Show>
        </button>
    );

    return (
        <div class={styles.compact}>
            <PaperSettingList
                flat
                autoHeight
                class={styles.form}
                value={{ ...props.settings } as Record<string, any>}
                onValueChange={props.onChange}
            >
                <section class={styles.group} aria-labelledby="settings-appearance">
                    <h2 id="settings-appearance" class={styles.heading}>Appearance</h2>
                    <div class={styles.card}>
                        <div class={styles.row}>
                            <span class={styles.label}>Theme</span>
                            <PaperSelectMenu name="darkMode" value={props.settings.darkMode}>
                                <PaperSelectMenuItem value="system" icon="contrast">System</PaperSelectMenuItem>
                                <PaperSelectMenuItem value="light" icon="light_mode">Light</PaperSelectMenuItem>
                                <PaperSelectMenuItem value="dark" icon="dark_mode">Dark</PaperSelectMenuItem>
                            </PaperSelectMenu>
                        </div>
                        <label class={styles.row}>
                            <span class={styles.label}>Reduce motion</span>
                            <PaperToggle name="reducedMotion" checked={props.settings.reducedMotion} />
                        </label>
                        {/* only phones vibrate, so only the phone layout asks */}
                        <label class={styles.row}>
                            <span class={styles.label}>Vibration</span>
                            <PaperToggle name="haptics" checked={props.settings.haptics} />
                        </label>
                    </div>
                </section>

                <section class={styles.group} aria-labelledby="settings-general">
                    <h2 id="settings-general" class={styles.heading}>General</h2>
                    <div class={styles.card}>
                        <label class={styles.row}>
                            <span class={styles.label}>Run on startup</span>
                            <PaperToggle name="runOnStartup" checked={props.settings.runOnStartup} />
                        </label>
                        <ActionRow label="Show tutorial" onClick={props.onShowTutorial} chevron />
                    </div>
                </section>
            </PaperSettingList>

            {/* browser mode has no updater window to restart into */}
            <Show when={!isBrowserShell()}>
                <section class={styles.group} aria-labelledby="settings-updates">
                    <h2 id="settings-updates" class={styles.heading}>Updates</h2>
                    <div class={styles.card}>
                        <ActionRow label="Update everything now" onClick={updateEverything} tone="primary" />
                    </div>
                    <p class={styles.note}>{UPDATE_NOTE}</p>
                </section>
            </Show>

            <section class={styles.group} aria-labelledby="settings-licenses">
                <h2 id="settings-licenses" class={styles.heading}>Licenses</h2>
                <div class={styles.card}>
                    <ActionRow label={LICENSE_TITLES.paperboard} onClick={() => props.onViewLicense("paperboard")} chevron />
                    <ActionRow label={`${LICENSE_TITLES.mit} (SDKs)`} onClick={() => props.onViewLicense("mit")} chevron />
                </div>
            </section>

            <Show when={!isBrowserShell()}>
                <section class={styles.group} aria-label="Quit">
                    <div class={styles.card}>
                        <ActionRow label="Quit Paperboard" onClick={quitApp} tone="danger" />
                    </div>
                    <p class={styles.note}>{QUIT_NOTE}</p>
                </section>
            </Show>

            {props.licenseModal}
        </div>
    );
}
