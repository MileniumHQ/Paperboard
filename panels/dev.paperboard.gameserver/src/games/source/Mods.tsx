import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { discardUpload, listAdded, newStage, pickFiles, stageFolder } from "../../lib/addons/upload";
import { sourceActions, type SourceGameSpec, type SourceModView } from "./index";
import type { SourcePlugin } from "./sourcemod";

const upload = pickFiles("Upload plugins", ["smx"]);

// SourceMod on a Source server: one switch for it, then its plugins, each
// turned on or off where SourceMod keeps them. There is no catalog that
// checks what it lists, so plugins come as .smx files the user uploads.
export default function SourceMods(props: { spec: SourceGameSpec; active: boolean }) {
    const ids = sourceActions(props.spec.id);
    const [view, setView] = createSignal<SourceModView | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [working, setWorking] = createSignal<string | null>(null);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const [notice, setNotice] = createSignal("");
    const [removing, setRemoving] = createSignal<SourcePlugin | null>(null);

    const load = async () => {
        setLoadError("");
        try {
            setView(await serverBridge.call<SourceModView>(ids.sourcemod));
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    createEffect(on([() => props.active, serverStatus], ([active]) => { if (active) void load(); }));

    const change = async (key: string, title: string, work: () => Promise<SourceModView>) => {
        setWorking(key);
        setError(null);
        setNotice("");
        try {
            setView(await work());
            return true;
        } catch (err) {
            setError({ title, message: errorMessage(err) });
            // whatever did land is what the page shows
            await load();
            return false;
        } finally {
            setWorking(null);
        }
    };
    // turning SourceMod on the first time downloads it, which can take a while
    const setOn = (on: boolean) => change("sourcemod", on ? "SourceMod did not turn on" : "SourceMod did not turn off", () => serverBridge.call<SourceModView>(ids.sourcemodSet, { on }, { timeoutMs: null }));
    const setPlugin = (plugin: SourcePlugin, on: boolean) => change(plugin.file, `${plugin.title} did not turn ${on ? "on" : "off"}`, () => serverBridge.call<SourceModView>(ids.plugin, { file: plugin.file, on }));
    const remove = async (plugin: SourcePlugin) => {
        if (await change(plugin.file, `${plugin.title} was not removed`, () => serverBridge.call<SourceModView>(ids.pluginRemove, { file: plugin.file }))) setRemoving(null);
    };
    const uploadPlugins = async () => {
        const stage = newStage();
        setWorking("upload");
        setError(null);
        setNotice("");
        try {
            const picked = await upload.pick(stageFolder(stage));
            if (picked.status === "canceled") {
                await discardUpload(stage);
                return;
            }
            const { added, view: next } = await serverBridge.call<{ added: string[]; view: SourceModView }>(ids.pluginUpload, { stage }, { timeoutMs: null });
            setView(next);
            setNotice(`${listAdded(added)} ${added.length === 1 ? "is" : "are"} on.`);
        } catch (err) {
            setError({ title: "Plugins not added", message: errorMessage(err) });
            await discardUpload(stage).catch((cleanup) => console.error(`[Mods] Failed to discard upload ${stage}:`, cleanup));
            await load();
        } finally {
            setWorking(null);
        }
    };

    const restart = () => {
        const current = view();
        return !!current && serverStatus() !== "offline" && current.on !== current.active;
    };
    const live = () => !!view()?.active;
    const status = () => {
        if (working() === "sourcemod") return view()?.on ? "Turning off…" : "Downloading and turning on…";
        return view()?.on ? "Metamod:Source and SourceMod load with the server." : "Admin commands, map votes and plugins, by AlliedModders.";
    };

    return (
        <>
            <PaperPageHeader icon="extension" title="Mods">
                <Show when={view()?.on && !view()?.missing}>
                    <PaperButton disabled={working() !== null} onClick={() => void uploadPlugins()}>
                        <PaperIcon aria-hidden="true">{working() === "upload" ? "hourglass_top" : upload.icon}</PaperIcon>
                        {upload.label}
                    </PaperButton>
                </Show>
            </PaperPageHeader>

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read SourceMod">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={view()}>
                {(current) => (
                    <PaperFlex direction="column" gap="full">
                        <PaperSettingList autoHeight>
                            <PaperSettingItem title="SourceMod" description={status()}>
                                <PaperToggle checked={current().on} disabled={working() !== null} onChange={(checked) => void setOn(checked)} />
                            </PaperSettingItem>
                        </PaperSettingList>

                        <Show when={error()}>
                            {(failure) => (
                                <PaperQuote variant="danger" icon="warning" title={failure().title} onDismiss={() => setError(null)}>
                                    {failure().message}
                                </PaperQuote>
                            )}
                        </Show>
                        <Show when={notice()}>
                            <PaperQuote variant="success" icon="check_circle" title="Plugins added" onDismiss={() => setNotice("")}>
                                {notice()}
                                {live() ? " They are running now." : ""}
                            </PaperQuote>
                        </Show>
                        <Show when={restart()}>
                            <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                                {current().on ? "Restart the server to load SourceMod and its plugins." : "SourceMod runs until the server restarts."}
                            </PaperQuote>
                        </Show>

                        <Show when={current().on && current().missing}>
                            <PaperQuote variant="danger" icon="error" title="SourceMod's files are missing">
                                The server won't start with SourceMod on. Turn it off and on again to reinstall it.
                            </PaperQuote>
                        </Show>
                        <Show when={current().on && !current().missing}>
                            <PaperText size={2} weight={700} color="text-subtle">Plugins</PaperText>
                            <PaperSettingList autoHeight>
                                <For each={current().plugins}>
                                    {(plugin) => (
                                        <PaperSettingItem title={plugin.title} description={plugin.bundled ? plugin.description : `${plugin.file} · ${plugin.description}`}>
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <Show when={!plugin.bundled}>
                                                    <PaperButton variant="text" disabled={working() !== null} onClick={() => setRemoving(plugin)}>
                                                        Remove
                                                    </PaperButton>
                                                </Show>
                                                <PaperToggle
                                                    checked={plugin.enabled}
                                                    disabled={working() !== null}
                                                    aria-label={`${plugin.title} on`}
                                                    onChange={(checked) => void setPlugin(plugin, checked)}
                                                />
                                            </PaperFlex>
                                        </PaperSettingItem>
                                    )}
                                </For>
                            </PaperSettingList>
                            <PaperText size={2} color="text-subtle">
                                {live() ? "Changes apply on the running server at once." : "Changes apply when the server starts."} Find more plugins on the AlliedModders forums and upload their compiled .smx files.
                            </PaperText>
                        </Show>
                    </PaperFlex>
                )}
            </Show>

            <PaperModal
                open={removing() !== null}
                onClose={() => setRemoving(null)}
                title={`Remove ${removing()?.title ?? "plugin"}`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setRemoving(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={working() !== null} onClick={() => { const plugin = removing(); if (plugin) void remove(plugin); }}>
                            Remove
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {removing()?.file} is deleted from the server. Its settings in cfg/sourcemod stay.
                </PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()!.message}</PaperText>
                </Show>
            </PaperModal>
        </>
    );
}
