import { For, createMemo, createSignal, Show } from "solid-js";
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
    PaperMarkdown,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSectionHeader,
    showToast,
} from "@mileniumhq/paperui";
import { isBrowserShell, shellIpc, signOutOfBrowser } from "../../lib/shell";
import { checkForUpdates } from "../../hooks/useAppUpdate";
import type { SettingsFailure } from "../../hooks/useAppSettings";
import { START_ON_HOME, startTarget } from "../../lib/startOn";
import type { AppSettingsData } from "../../lib/appSettings";
import type { UpdateCheckOutcome } from "../../../../shared/updateQueue";
import { computerIcon } from "../computer/computerIcon";
import PanelPermissionSettings from "./PanelPermissionSettings";
// Inlined at build time: the viewer always shows the exact files shipped
// in this repo, so the text cannot drift from the license on disk.
import paperboardLicenseText from "../../../../../LICENSE?raw";
import mitLicenseText from "@mileniumhq/paperui/LICENSE?raw";
import { effectiveLook } from "../../../../shared/graphics";
import { errorMessage } from "@mileniumhq/paperapi";

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
const UPDATE_CHECKING = "Looking for updates to Paperboard, every panel, package, and computer...";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** what a look for updates came to, in words */
export function updateOutcomeText(outcome: UpdateCheckOutcome): string {
    const said: string[] = [];
    if (outcome.updated) said.push(`Installed ${count(outcome.updated, "update", "updates")}.`);
    if (outcome.held) said.push(`${count(outcome.held, "update waits", "updates wait")} until what uses it stops. The top bar lists them.`);
    if (outcome.failed) said.push(sentence(outcome.problem ?? `${count(outcome.failed, "update", "updates")} failed`));
    if (!said.length) said.push("Everything is up to date.");
    if (outcome.linked) {
        said.push(`${count(outcome.linked, "linked panel wasn't", "linked panels weren't")} updated: ${outcome.linked === 1 ? "it runs" : "they run"} from ${outcome.linked === 1 ? "its" : "their"} source folder.`);
    }
    return said.join(" ");
}
const QUIT_NOTE = "Stops the panels on this computer, unless its server daemon runs as a service. Panels on other computers keep running.";

const quitApp = () => shellIpc().send("quit-app");
const SIGN_OUT_NOTE = "Signs this browser out. Open Paperboard in the browser from Paperboard to come back.";
const signOut = () =>
    signOutOfBrowser().catch((err) => showToast({ variant: "danger", title: "Couldn't sign out", message: errorMessage(err) }));

export default function AppSettings(props: {
    settings: AppSettingsData;
    onChange: (next: AppSettingsData) => void;
    /** the computers Paperboard can open on, besides Home */
    computers: StartComputer[];
    /** a panel's name, for the permissions you've given panels */
    panelName?: (panelId: string) => string;
    /** the phone layout: a page of its own, with only what applies on a phone */
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

    // the last look for updates from here: running, or what it came to
    const [updateCheck, setUpdateCheck] = createSignal<"checking" | UpdateCheckOutcome | null>(null);
    const updateNow = () => {
        setUpdateCheck("checking");
        checkForUpdates().then(
            (outcome) => {
                setUpdateCheck(outcome);
                if (outcome.failed) showToast({ variant: "danger", title: "Not everything updated", message: updateOutcomeText(outcome) });
            },
            (err) => {
                setUpdateCheck(null);
                showToast({ variant: "danger", title: "Couldn't check for updates", message: errorMessage(err) });
            },
        );
    };
    const updateNote = () => {
        const check = updateCheck();
        return check === null ? UPDATE_NOTE : check === "checking" ? UPDATE_CHECKING : updateOutcomeText(check);
    };

    const startOnMissing = () => startTarget(props.settings.startOn, props.computers).missing;
    // one value object per settings change, not a new one on every read
    const settingsValue = createMemo(() => ({ ...props.settings }) as Record<string, any>);

    // what shows, and whether it's on only because there's no GPU
    const look = () => ({
        ...effectiveLook(props.settings, { gpu: props.gpu }),
        animationsByDefault: !props.gpu && props.settings.disableAnimations === undefined,
        blurByDefault: !props.gpu && props.settings.disableBlur === undefined,
    });

    const handleChange = (next: Record<string, any>) => {
        props.onChange({ ...props.settings, ...next });
    };

    return (
        // the phone's page has its own title bar, and a phone doesn't start
        // at login, update itself, or quit: those rows are the desktop's
        <PaperPage padding={props.compact ? "full" : undefined}>
            <Show when={!props.compact}>
                <PaperPageHeader
                    icon="settings"
                    title="App Settings"
                    subtitle={isBrowserShell() ? "Appearance, startup, and licenses." : "Appearance, startup, updates, and licenses."}
                />
            </Show>
            <Show when={props.failure}>
                {(failure) => (
                    <PaperQuote
                        variant="danger"
                        icon="warning"
                        title={{ load: "Settings not loaded", save: "Settings not saved", apply: "Run on startup not applied" }[failure().kind]}
                        role="alert"
                        onDismiss={props.onDismissFailure}
                    >
                        <PaperFlex direction="column" gap="half" align="flex-start">
                            {{
                                load: `These are the defaults, not your settings: ${failure().message}`,
                                save: `Your change was not kept: ${failure().message}`,
                                apply: failure().message,
                            }[failure().kind]}
                            <Show when={failure().kind === "load" && props.onRetryLoad}>
                                <PaperButton size="tiny" onClick={() => props.onRetryLoad?.()}>Retry loading</PaperButton>
                            </Show>
                        </PaperFlex>
                    </PaperQuote>
                )}
            </Show>

            <PaperSettingList autoHeight value={settingsValue()} onValueChange={handleChange}>
                <PaperSettingItem title="Appearance" description="Match the operating system appearance or force light or dark.">
                    <PaperSelectMenu name="darkMode" value={props.settings.darkMode} fullWidth={!props.compact}>
                        <PaperSelectMenuItem value="system" icon="contrast">System</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="light" icon="light_mode">Light</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="dark" icon="dark_mode">Dark</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Disable animations"
                    description={look().animationsByDefault ? NO_GPU : "Turns off animations and transitions."}
                >
                    <PaperToggle name="disableAnimations" checked={look().disableAnimations} />
                </PaperSettingItem>

                <PaperSettingItem
                    title="Disable blur"
                    description={look().blurByDefault ? NO_GPU : "Turns off the blur behind dialogs and overlays."}
                >
                    <PaperToggle name="disableBlur" checked={look().disableBlur} />
                </PaperSettingItem>

                <PaperSettingItem title="Start on" description={startOnMissing() ? START_ON_MISSING : START_ON_NOTE}>
                    <PaperSelectMenu name="startOn" value={props.settings.startOn} fullWidth={!props.compact}>
                        <StartOnItems computers={props.computers} startOn={props.settings.startOn} />
                    </PaperSelectMenu>
                </PaperSettingItem>

                <Show when={!props.compact}>
                    <PaperSettingItem title="Run on startup" description="Launch Paperboard automatically when you log in.">
                        <PaperToggle name="runOnStartup" checked={props.settings.runOnStartup} />
                    </PaperSettingItem>
                </Show>

                {/* browser mode runs no updates */}
                <Show when={!props.compact && !isBrowserShell()}>
                    <PaperSettingItem title="Updates" description={updateNote()}>
                        <PaperEffect variant="primary">
                            <PaperButton onClick={updateNow}>
                                <PaperIcon>update</PaperIcon>
                                Update everything now
                            </PaperButton>
                        </PaperEffect>
                    </PaperSettingItem>

                    <PaperSettingItem title="Quit App" description={QUIT_NOTE}>
                        <PaperButton variant="danger" onClick={quitApp} aria-label="Quit Paperboard">
                            <PaperIcon>close</PaperIcon>
                            Quit App
                        </PaperButton>
                    </PaperSettingItem>
                </Show>

                <Show when={isBrowserShell()}>
                    <PaperSettingItem title="Sign out" description={SIGN_OUT_NOTE}>
                        <PaperButton onClick={signOut}>
                            <PaperIcon>logout</PaperIcon>
                            Sign Out
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
                <PaperSettingItem title={LICENSE_TITLES.paperboard} description="Your Paperboard experience">
                    <PaperButton size="small" onClick={() => viewLicense("paperboard")} aria-label={`View ${LICENSE_TITLES.paperboard} license`}>
                        View
                    </PaperButton>
                </PaperSettingItem>
                <PaperSettingItem title={LICENSE_TITLES.mit} description="Applies to SDKs">
                    <PaperButton size="small" onClick={() => viewLicense("mit")} aria-label={`View ${LICENSE_TITLES.mit}`}>
                        View
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal open={licenseOpen()} onClose={() => setLicenseOpen(false)} title={LICENSE_TITLES[license()]} size="large">
                <PaperMarkdown text={LICENSE_TEXTS[license()]} />
            </PaperModal>
        </PaperPage>
    );
}
