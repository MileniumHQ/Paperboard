// The shell's failures on real PaperUI, through the real hooks and paperapi
// transport to a real PaperCrane the test starts (its credentials come in
// the query string) and stops mid-run. Main's other answers are the ones it
// gives when the thing fails: the file manager won't open a folder, nearby
// computers can't be listed. Each failure has to show itself with its
// reason.
import { render } from "solid-js/web";
import { configureHostConnection, initPaperApi } from "@mileniumhq/paperapi";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "../../../src/renderer/src/shell.css";
import { shellIpc } from "../../../src/renderer/src/lib/shell";
import { useAppSettings } from "../../../src/renderer/src/hooks/useAppSettings";
import AppSettings from "../../../src/renderer/src/components/settings/AppSettings";
import TopBar from "../../../src/renderer/src/components/layout/TopBar";
import ComputerSetupWizard from "../../../src/renderer/src/components/wizard/ComputerSetupWizard";

const out = { checks: {} as Record<string, unknown>, error: "" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const credentials = JSON.parse(new URLSearchParams(location.search).get("crane") ?? "null");
let folderAnswer: () => Promise<unknown> = async () => ({ opened: false, error: "No application is registered as handling this file" });
const main: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    "crane-credentials": async () => credentials,
    "open-panel-folder": () => folderAnswer(),
    "discovery-list": async () => { throw new Error("Discovery is not running"); },
    "app-version": async () => "0.0.0-fixture",
};
(window as any).electron = {
    ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => {
            const answer = main[channel];
            return answer ? answer(...args) : Promise.reject(new Error(`fixture: no answer for ${channel}`));
        },
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined,
    },
};
configureHostConnection(() => shellIpc().invoke<{ port: number; token: string }>("crane-credentials"));

let settings!: ReturnType<typeof useAppSettings>;
const mount = () => render(() => (
    <PaperProvider fullWidth fullHeight>
        {(() => { settings = useAppSettings(); return null; })()}
        <TopBar
            updateState={{ status: "idle" } as any}
            onOpenUpdate={() => undefined}
            packageUpdatesWaiting={0}
            onOpenPackageUpdates={() => undefined}
            getComputerId={() => "local"}
            getSelectedTab={() => "landing"}
        />
        <AppSettings
            settings={settings.appSettings()}
            onChange={settings.handleAppSettingsChange}
            onShowTutorial={() => undefined}
            failure={settings.settingsFailure()}
            onRetryLoad={() => void settings.retryLoadAppSettings()}
            onDismissFailure={settings.dismissSettingsFailure}
        />
        <ComputerSetupWizard onClose={() => undefined} onComplete={() => undefined} />
    </PaperProvider>
), document.getElementById("app")!);

const alerts = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')];
const alertTitled = (title: string) =>
    alerts().find((el) => [...el.querySelectorAll("*")].some((c) => c.textContent?.trim() === title));
const dialogTitled = (title: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].find((d) =>
        document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent === title);

async function run() {
    const c = out.checks;
    // the shell's own bootstrap: connect, then render
    await initPaperApi({ computerId: "local" });
    mount();
    await sleep(200);

    // with the store up, settings load and nothing is wrong
    c.loadedWhileUp = await settings.loadAppSettings();
    c.noFailureWhileUp = !alertTitled("Settings not loaded") && !alertTitled("Settings not saved");

    // the store goes down: settings that can't be read say the defaults are
    // showing, with the reason, and a retry that fails again stays
    await fetch("/control/crane-down");
    await settings.loadAppSettings();
    await sleep(50);
    const notLoaded = alertTitled("Settings not loaded");
    c.loadShown = Boolean(notLoaded);
    c.loadReason = notLoaded?.textContent ?? "";
    const retry = notLoaded && [...notLoaded.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry loading"));
    c.loadRetry = Boolean(retry);
    retry?.click();
    await sleep(300);
    c.loadStillShownAfterFailedRetry = Boolean(alertTitled("Settings not loaded"));
    alertTitled("Settings not loaded")?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click();
    await sleep(50);
    c.loadDismissed = !alertTitled("Settings not loaded");

    // a change that can't be saved says it wasn't kept, with the reason
    const toggle = document.querySelector<HTMLInputElement>('input[name="reducedMotion"]')?.closest<HTMLElement>('[role="switch"]');
    if (!toggle) throw new Error("App Settings has no reduced motion switch");
    toggle.click();
    await sleep(300);
    const notSaved = alertTitled("Settings not saved");
    c.saveShown = Boolean(notSaved);
    c.saveReason = notSaved?.textContent ?? "";
    c.saveNotApplied = !settings.appSettings().reducedMotion;
    c.switchShowsKeptValue = toggle.getAttribute("aria-checked") === "false";

    // a folder the file manager won't open says why
    const folder = document.querySelector<HTMLButtonElement>('button[aria-label="Open panel folder"]');
    if (!folder) throw new Error("the title bar has no folder button");
    folder.click();
    await sleep(100);
    const folderModal = dialogTitled("Folder not opened");
    c.folderShown = Boolean(folderModal);
    c.folderReason = folderModal?.querySelector('[role="alert"]')?.textContent ?? "";
    folderModal?.querySelector<HTMLButtonElement>('[aria-label="Close modal"]')?.click();
    await sleep(400);

    // and so does a folder request main refused outright
    folderAnswer = async () => { throw new Error("Invalid parameter: panelId"); };
    folder.click();
    await sleep(100);
    c.folderRefusalReason = dialogTitled("Folder not opened")?.querySelector('[role="alert"]')?.textContent ?? "";

    // nearby computers that can't be listed say so, and adding by address stays
    const discovery = alertTitled("Nearby computers not listed");
    c.discoveryShown = Boolean(discovery);
    c.discoveryReason = Boolean(discovery?.textContent?.includes("Discovery is not running"));
}

void run()
    .catch((err) => { out.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err); })
    .finally(() => void fetch("/results", { method: "POST", body: JSON.stringify(out) }));
