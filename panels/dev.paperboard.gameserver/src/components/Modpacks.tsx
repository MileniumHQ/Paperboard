import { createSignal, Show } from "solid-js";
import { PaperFlex, PaperProgress, PaperQuote, PaperText } from "@mileniumhq/paperui";
import RecoveryNotice from "./RecoveryNotice";
import { modpackProgress, serverStatus, serverVersion } from "../lib/server";
import { loaderName, modpacksKind } from "../lib/addons/modpacks";
import { versionLabel } from "../lib/addons/presentation";
import type { ModpackInstallOutcome } from "../lib/modpacks";
import AddonBrowser from "./addons/AddonBrowser";
import type { InstallExtrasProps } from "./addons/AddonModals";
import { createAddonBrowser } from "./addons/state";

const STAGE_LABEL = {
    preparing: "Reading the modpack…",
    downloading: "Downloading mods…",
    "installing-server": "Installing the pack's loader…",
    placing: "Placing files…",
    completed: "Installed",
    error: "Failed",
} as const;

// where an install is, from the service's progress
function InstallStages() {
    return (
        <Show when={modpackProgress()}>
            {(p) => (
                <PaperFlex direction="column" gap="half">
                    <PaperText size={2} color="text-subtle">
                        {STAGE_LABEL[p().stage]}
                        {p().stage === "downloading" ? ` ${p().done} of ${p().total}` : ""}
                    </PaperText>
                    <PaperProgress
                        value={p().stage === "downloading" ? p().done : undefined}
                        max={Math.max(1, p().total)}
                        aria-label={STAGE_LABEL[p().stage]}
                    />
                </PaperFlex>
            )}
        </Show>
    );
}

// Installing a pack replaces the mod set and may move the server to the
// pack's Minecraft version, so the dialog says so and shows the stages.
function ModpackInstallNotes(props: InstallExtrasProps) {
    const switches = () => {
        const versions = props.version?.gameVersions;
        return !!versions && versions.length > 0 && !versions.includes(serverVersion());
    };
    return (
        <>
            <PaperQuote variant="warning" icon="warning" title="This replaces the server's mods">
                Every jar in mods/ moves to the server folder's trash, and configs the pack ships replace yours (the old ones go to the trash
                too). Worlds and server.properties are kept.
                <Show when={switches()}>
                    {" "}
                    The server switches to Minecraft {props.version!.gameVersions!.join(", ")}; a world opened by a newer version cannot go back.
                </Show>
            </PaperQuote>
            <Show when={props.installing}>
                <InstallStages />
            </Show>
        </>
    );
}

// Modpacks: one Modrinth pack for the server's loader, in the shared add-on
// browser, with the server-must-be-stopped rule, the recovery notice and
// the outcome of the last install.
export default function Modpacks(props: { active: boolean }) {
    const [outcome, setOutcome] = createSignal<ModpackInstallOutcome | null>(null);
    const browser = createAddonBrowser({
        kind: modpacksKind,
        active: () => props.active,
        installed: (result) => setOutcome(result as ModpackInstallOutcome),
        removed: () => setOutcome(null),
    });

    return (
        <AddonBrowser
            browser={browser}
            installExtras={ModpackInstallNotes}
            notices={
                <>
                    <RecoveryNotice />
                    <Show when={browser.uploading()}>
                        <PaperQuote icon="info" title="Installing the uploaded modpack">
                            <InstallStages />
                        </PaperQuote>
                    </Show>
                    <Show when={serverStatus() !== "offline"}>
                        <PaperQuote icon="info" title="The server is running">
                            Stop the server to install, update or remove a modpack.
                        </PaperQuote>
                    </Show>
                    <Show when={outcome()}>
                        {(done) => (
                            <PaperQuote
                                variant={done().warning ? "warning" : "success"}
                                icon={done().warning ? "warning" : "check_circle"}
                                title={`${done().title} ${versionLabel(done().versionNumber)} installed`}
                            >
                                <PaperFlex direction="column" gap="half">
                                    <span>
                                        {done().switchedServer
                                            ? `The server now runs ${loaderName()} ${done().loaderVersion} for Minecraft ${done().mcVersion}. `
                                            : ""}
                                        The replaced mods and configs are in the server folder's trash.
                                    </span>
                                    <Show when={done().kept.length > 0}>
                                        <span>
                                            Kept your own {done().kept.slice(0, 3).join(", ")}
                                            {done().kept.length > 3 ? ` and ${done().kept.length - 3} more` : ""} instead of the pack's copy.
                                        </span>
                                    </Show>
                                    <Show when={done().warning}>
                                        <span>{done().warning}</span>
                                    </Show>
                                </PaperFlex>
                            </PaperQuote>
                        )}
                    </Show>
                </>
            }
        />
    );
}
