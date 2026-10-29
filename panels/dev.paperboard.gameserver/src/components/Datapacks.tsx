import { createSignal, Show } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { serverBridge, serverStatus } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import { errorMessage } from "../lib/failure";
import { datapacksKind } from "../lib/addons/datapacks";
import AddonBrowser from "./addons/AddonBrowser";
import { createAddonBrowser } from "./addons/state";

// Datapacks: the shared add-on browser over the active world's datapacks/
// folder, plus the world note and the reload command only this tab has.
export default function Datapacks(props: { active: boolean }) {
    const browser = createAddonBrowser({ kind: datapacksKind, active: () => props.active });
    const world = () => browser.listing()?.meta;

    const [reloading, setReloading] = createSignal(false);
    const [reloadMessage, setReloadMessage] = createSignal<{ ok: boolean; text: string } | null>(null);
    const reload = async () => {
        setReloading(true);
        setReloadMessage(null);
        try {
            await serverBridge.call(ACTION_IDS.runCommand, { command: "reload" });
            setReloadMessage({ ok: true, text: "Reload sent. The console shows whether every datapack loaded." });
        } catch (err) {
            setReloadMessage({ ok: false, text: errorMessage(err) });
        } finally {
            setReloading(false);
        }
    };

    return (
        <AddonBrowser
            browser={browser}
            actions={
                <Show when={serverStatus() === "online"}>
                    <PaperEffect variant="primary">
                        <PaperButton disabled={reloading()} onClick={() => void reload()}>
                            <PaperIcon aria-hidden="true">refresh</PaperIcon>
                            {reloading() ? "Reloading…" : "Reload datapacks"}
                        </PaperButton>
                    </PaperEffect>
                </Show>
            }
            notices={
                <>
                    <Show when={reloadMessage()}>
                        {(note) => (
                            <PaperQuote
                                variant={note().ok ? undefined : "danger"}
                                icon={note().ok ? "info" : "warning"}
                                title={note().ok ? "Reloading" : "Could not reload"}
                            >
                                {note().text}
                            </PaperQuote>
                        )}
                    </Show>
                    <Show when={world()}>
                        {(view) => (
                            <PaperQuote icon="info" title={`World: ${view().world}`}>
                                <Show
                                    when={view().worldExists}
                                    fallback={<>This world has not been created yet. Datapacks installed now load when the server creates it.</>}
                                >
                                    New datapacks load after a reload or restart. Packs that change world generation only affect chunks
                                    generated after they load.
                                </Show>
                            </PaperQuote>
                        )}
                    </Show>
                </>
            }
            installExtras={() => (
                <PaperText size={2} color="text-subtle">
                    Installs into {world()?.world ?? "the active world"}/datapacks/.
                </PaperText>
            )}
        />
    );
}
