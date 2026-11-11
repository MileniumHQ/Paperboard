import { For, createSignal, type JSX, Show } from "solid-js";
import {
    PaperSettingList,
    PaperSettingItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperToggle,
    PaperEffect,
    PaperFlex,
    PaperButton,
    PaperIcon,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSectionHeader,
    PaperText,
    showToast,
} from "@mileniumhq/paperui";
import { isBrowserShell, shellIpc } from "../../lib/shell";
import type { SettingsFailure } from "../../hooks/useAppSettings";
import { START_ON_HOME, startTarget } from "../../lib/startOn";
import { computerIcon } from "../computer/computerIcon";
import PanelPermissionSettings from "./PanelPermissionSettings";
import styles from "./AppSettings.module.css";
// Inlined at build time: the viewer always shows the exact files shipped
// in this repo, so the text cannot drift from the license on disk.
import paperboardLicenseText from "../../../../../LICENSE?raw";
import mitLicenseText from "../../../../../../../packages/paperui/LICENSE?raw";
import { effectiveLook } from "../../../../shared/graphics";

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

/** a computer Paperboard can open on */
export interface StartComputer {
    id: string;
    name: string;
    isLocal?: boolean;
}

const START_ON_NOTE = "Open Paperboard on Home or on a computer's panels.";
const NO_GPU = "On because this computer has no graphics card, and Paperboard would lag with it off.";
const START_ON_MISSING = "That computer isn't listed anymore, so Paperboard opens Home.";

// Home, then each computer the rail lists, the way the rail shows them. A
// chosen computer that's gone still has a row, so the menu never shows its id.
function StartOnItems(props: { computers: StartComputer[]; startOn: string }) {
    return (
        <>
            <PaperSelectMenuItem value={START_ON_HOME} icon="home">Home</PaperSelectMenuItem>
            <Show when={startTarget(props.startOn, props.computers).missing}>
                <PaperSelectMenuItem value={props.startOn} icon="link_off">Removed computer</PaperSelectMenuItem>
            </Show>
            <For each={props.computers}>
                {(comp) => (
                    <PaperSelectMenuItem value={comp.id} icon={computerIcon(comp)}>
                        {comp.name}
                    </PaperSelectMenuItem>
                )}
            </For>
        </>
    );
}

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

const UPDATE_NOTE = "Looks for updates to Paperboard, every panel, package, and computer now. The top bar shows them as they run.";
const QUIT_NOTE = "Stops the panels on this computer, unless its server daemon runs as a service. Panels on other computers keep running.";

// the top bar lists what it finds, and says each failure
const updateEverything = () =>
    shellIpc()
        .invoke<void>("update-check")
        .catch((err) => showToast({ variant: "danger", title: "Couldn't check for updates", message: String(err) }));
const quitApp = () => shellIpc().send("quit-app");

export default function AppSettings(props: {
    settings: AppSettingsData;
    onChange: (next: AppSettingsData) => void;
    /** reopens Paperboard's own tutorial */
    onShowTutorial: () => void;
    /** the computers Paperboard can open on, besides Home */
    computers: StartComputer[];
    /** a panel's name, for the permissions you've given panels */
    panelName?: (panelId: string) => string;
    /** the phone layout: grouped rows, the way phones lay out settings */
    compact?: boolean;
    /** a load or save that didn't go through */
    failure?: SettingsFailure | null;
    /** false where there's no GPU: animations and blur are off until the user chooses */
    gpu: boolean;
    onRetryLoad?: () => void;
    onDismissFailure?: () => void;
}) {
    // the license stays in the modal after it closes, so it fades out whole
    const [license, setLicense] = createSignal<LicenseKind>("paperboard");
    const [licenseOpen, setLicenseOpen] = createSignal(false);
    const viewLicense = (kind: LicenseKind) => {
        setLicense(kind);
        setLicenseOpen(true);
    };

    const startOnMissing = () => startTarget(props.settings.startOn, props.computers).missing;

    // what shows, and whether it's on only because there's no GPU
    const look = () => ({
        ...effectiveLook(props.settings, { gpu: props.gpu }),
        animationsByDefault: !props.gpu && props.settings.disableAnimations === undefined,
        blurByDefault: !props.gpu && props.settings.disableBlur === undefined,
    });

    const handleChange = (next: Record<string, any>) => {
        props.onChange({ ...props.settings, ...next });
    };

    // one modal for both layouts, built once and opened through licenseOpen
    const licenseModal = (
        <PaperModal
            open={licenseOpen()}
            onClose={() => setLicenseOpen(false)}
            title={LICENSE_TITLES[license()]}
            size="large"
        >
            <PaperText as="pre" family="code" size={2} class={styles.licenseText}>
                {LICENSE_TEXTS[license()]}
            </PaperText>
        </PaperModal>
    );

    const failureNotice = (
        <Show when={props.failure}>
            {(failure) => (
                <PaperQuote
                    variant="danger"
                    icon="warning"
                    title={{ load: "Settings not loaded", save: "Settings not saved", apply: "Run on startup not applied", graphics: "Graphics card not checked" }[failure().kind]}
                    role="alert"
                    onDismiss={props.onDismissFailure}
                >
                    <PaperFlex direction="column" gap="half" align="flex-start">
                        {{
                            load: `These are the defaults, not your settings: ${failure().message}`,
                            save: `Your change was not kept: ${failure().message}`,
                            apply: failure().message,
                            graphics: `Animations and blur stay on unless you turn them off, even if this computer has no graphics card: ${failure().message}`,
                        }[failure().kind]}
                        <Show when={failure().kind === "load" && props.onRetryLoad}>
                            <PaperButton size="tiny" onClick={() => props.onRetryLoad?.()}>Retry loading</PaperButton>
                        </Show>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );

    if (props.compact) {
        return (
            <CompactSettings
                notice={failureNotice}
                settings={props.settings}
                gpu={props.gpu}
                onChange={handleChange}
                onShowTutorial={props.onShowTutorial}
                computers={props.computers}
                onViewLicense={viewLicense}
                licenseModal={licenseModal}
            />
        );
    }

    return (
        <PaperPage>
            <PaperPageHeader
                icon="settings"
                title="App Settings"
                subtitle={isBrowserShell() ? "Appearance, startup, and licenses." : "Appearance, startup, updates, and licenses."}
            />
            {failureNotice}

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
                    title="Disable animations"
                    description={look().animationsByDefault ? NO_GPU : "Turns off animations and transitions."}
                >
                    <PaperToggle
                        name="disableAnimations"
                        checked={look().disableAnimations}
                    />
                </PaperSettingItem>

                <PaperSettingItem
                    title="Disable blur"
                    description={look().blurByDefault ? NO_GPU : "Turns off the blur behind dialogs and overlays."}
                >
                    <PaperToggle
                        name="disableBlur"
                        checked={look().disableBlur}
                    />
                </PaperSettingItem>

                <PaperSettingItem title="Start on" description={startOnMissing() ? START_ON_MISSING : START_ON_NOTE}>
                    <PaperSelectMenu name="startOn" value={props.settings.startOn} fullWidth>
                        <StartOnItems computers={props.computers} startOn={props.settings.startOn} />
                    </PaperSelectMenu>
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

                {/* browser mode runs no updates */}
                <Show when={!isBrowserShell()}>
                    <PaperSettingItem
                        title="Updates"
                        description={UPDATE_NOTE}
                    >
                        <PaperEffect variant="primary">
                            <PaperButton
                                onClick={updateEverything}>
                                <PaperIcon>update</PaperIcon>
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

            {/* browser mode: the browser keeps its own permissions */}
            <Show when={!isBrowserShell() && props.panelName}>
                {(panelName) => <PanelPermissionSettings panelName={panelName()} />}
            </Show>

            <PaperSectionHeader icon="license" title="Licenses" />
            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="PolyForm Noncommercial 1.0.0"
                    description="Your Paperboard experience"
                >
                    <PaperButton
                        size="small"
                        onClick={() => viewLicense("paperboard")}
                        aria-label="View PolyForm Noncommercial 1.0.0 license"
                    >
                        View
                    </PaperButton>
                </PaperSettingItem>
                <PaperSettingItem title="MIT license" description="Applies to SDKs">
                    <PaperButton
                        size="small"
                        onClick={() => viewLicense("mit")}
                        aria-label="View MIT license"
                    >
                        View
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            {licenseModal}
        </PaperPage>
    );
}

// The phone layout: titled groups of one-line rows, controls on the right,
// and actions as rows you tap. Only what applies on a phone is here.
function CompactSettings(props: {
    settings: AppSettingsData;
    gpu: boolean;
    onChange: (next: Record<string, any>) => void;
    onShowTutorial: () => void;
    computers: StartComputer[];
    onViewLicense: (kind: LicenseKind) => void;
    licenseModal: JSX.Element;
    notice: JSX.Element;
}) {
    const ActionRow = (row: { label: string; onClick: () => void; chevron?: boolean }) => (
        <button
            type="button"
            class={styles.row}
            onClick={row.onClick}
        >
            <PaperText preset="label" class={styles.label}>{row.label}</PaperText>
            <Show when={row.chevron}>
                <PaperIcon class={styles.chevron} aria-hidden="true">chevron_right</PaperIcon>
            </Show>
        </button>
    );

    return (
        <div class={styles.compact}>
            {props.notice}
            <PaperSettingList
                flat
                autoHeight
                class={styles.form}
                value={{ ...props.settings } as Record<string, any>}
                onValueChange={props.onChange}
            >
                <section class={styles.group} aria-labelledby="settings-appearance">
                    <h2 id="settings-appearance" class={styles.heading}><PaperText preset="section" inset>Appearance</PaperText></h2>
                    <div class={styles.card}>
                        <div class={styles.row}>
                            <PaperText preset="label" class={styles.label}>Theme</PaperText>
                            <PaperSelectMenu name="darkMode" value={props.settings.darkMode}>
                                <PaperSelectMenuItem value="system" icon="contrast">System</PaperSelectMenuItem>
                                <PaperSelectMenuItem value="light" icon="light_mode">Light</PaperSelectMenuItem>
                                <PaperSelectMenuItem value="dark" icon="dark_mode">Dark</PaperSelectMenuItem>
                            </PaperSelectMenu>
                        </div>
                        <label class={styles.row}>
                            <PaperText preset="label" class={styles.label}>Disable animations</PaperText>
                            <PaperToggle name="disableAnimations" checked={effectiveLook(props.settings, { gpu: props.gpu }).disableAnimations} />
                        </label>
                        <label class={styles.row}>
                            <PaperText preset="label" class={styles.label}>Disable blur</PaperText>
                            <PaperToggle name="disableBlur" checked={effectiveLook(props.settings, { gpu: props.gpu }).disableBlur} />
                        </label>
                    </div>
                </section>

                <section class={styles.group} aria-labelledby="settings-general">
                    <h2 id="settings-general" class={styles.heading}><PaperText preset="section" inset>General</PaperText></h2>
                    <div class={styles.card}>
                        <div class={styles.row}>
                            <PaperText preset="label" class={styles.label}>Start on</PaperText>
                            <PaperSelectMenu name="startOn" value={props.settings.startOn}>
                                <StartOnItems computers={props.computers} startOn={props.settings.startOn} />
                            </PaperSelectMenu>
                        </div>
                        <ActionRow label="Show tutorial" onClick={props.onShowTutorial} chevron />
                    </div>
                </section>
            </PaperSettingList>

            {/* a phone doesn't start at login, update itself, or quit: those rows are the desktop's */}
            <section class={styles.group} aria-labelledby="settings-licenses">
                <h2 id="settings-licenses" class={styles.heading}><PaperText preset="section" inset>Licenses</PaperText></h2>
                <div class={styles.card}>
                    <ActionRow label={LICENSE_TITLES.paperboard} onClick={() => props.onViewLicense("paperboard")} chevron />
                    <ActionRow label={`${LICENSE_TITLES.mit} (SDKs)`} onClick={() => props.onViewLicense("mit")} chevron />
                </div>
            </section>

            {props.licenseModal}
        </div>
    );
}
