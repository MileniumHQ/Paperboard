import { createSignal, Show } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperQuote, PaperText, showError } from "@mileniumhq/paperui";
import { useServer } from "../lib/server";
import { errorMessage } from "../lib/failure";
import { datapacksKind } from "../lib/addons/datapacks";
import AddonBrowser from "./addons/AddonBrowser";
import { createAddonBrowser } from "./addons/state";

// Datapacks: the shared add-on browser over the active world's datapacks/
// folder, plus the world note and the reload command only this tab has.
export default function Datapacks(props: { active: boolean }) {
    const server = useServer();
    const { calls, serverStatus } = server;
    const browser = createAddonBrowser({ kind: datapacksKind(server), active: () => props.active });
    const world = () => browser.listing()?.meta;

    const [reloading, setReloading] = createSignal(false);
    const [reloadSent, setReloadSent] = createSignal(false);
    const reload = async () => {
        setReloading(true);
        setReloadSent(false);
        try {
            await calls.runCommand({ command: "reload" });
            setReloadSent(true);
        } catch (err) {
            showError("Couldn't reload the datapacks", errorMessage(err));
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
                    <Show when={reloadSent()}>
                        <PaperQuote icon="info" title="Reloading">
                            Reload sent. The console shows whether every datapack loaded.
                        </PaperQuote>
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
