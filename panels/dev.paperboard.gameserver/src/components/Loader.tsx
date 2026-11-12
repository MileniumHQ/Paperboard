import { minecraftSoftware } from "../games/minecraft/index";
import { createEffect, createSignal, on, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperPageHeader, PaperQuote } from "@mileniumhq/paperui";
import ConfigSettings from "./ConfigSettings";
import { serverBridge, serverSoftware, serverStatus } from "../lib/server";
import { CALLS } from "../service/contract";
import { SOFTWARE_NAMES } from "../lib/software";
import type { LoaderSettingsView } from "../service/loaderSettings";

// Loader: the installed software's own settings files (Paper's YAML,
// NeoForge/Forge TOML). The service owns reading and writing; this tab
// only shows what the files hold and sends one validated edit at a time.
export default function Loader(props: { active: boolean }) {
    const [settings, setSettings] = createSignal<LoaderSettingsView | null>(null);
    const [loadError, setLoadError] = createSignal("");

    const load = async () => {
        setLoadError("");
        try {
            setSettings(await serverBridge.call<LoaderSettingsView>(CALLS.readLoaderSettings));
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };

    // read whenever the tab opens or the software changes: the files
    // appear on the server's first start and differ per software
    createEffect(
        on([() => props.active, serverSoftware], ([active]) => {
            if (active) void load();
        }),
    );

    const name = () => SOFTWARE_NAMES[minecraftSoftware(serverSoftware())];

    return (
        <>
            <PaperPageHeader icon="settings_applications" title="Loader" />
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read the loader settings">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={settings()}>
                {(view) => (
                    <Show
                        when={!view().emptyMessage}
                        fallback={
                            <PaperQuote icon="info" title={`No ${name()} settings`}>
                                {view().emptyMessage}
                            </PaperQuote>
                        }
                    >
                        <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                            These are {name()}'s own settings files. Changes take effect the next time the server
                            starts{serverStatus() !== "offline" ? ", so restart it to apply them" : ""}.
                        </PaperQuote>
                        <Show when={view().missing.length > 0 && view().groups.length === 0}>
                            <PaperQuote icon="info" title="Settings not created yet">
                                Start the server once so {name()} creates its settings files, then come back here.
                            </PaperQuote>
                        </Show>
                        <ConfigSettings
                            groups={view().groups}
                            write={(id, value) => serverBridge.call(CALLS.writeLoaderSetting, { id, value })}
                            reload={load}
                        />
                    </Show>
                )}
            </Show>
        </>
    );
}
