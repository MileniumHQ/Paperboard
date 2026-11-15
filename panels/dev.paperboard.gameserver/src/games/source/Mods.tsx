import { createMemo, createSignal, For, Show } from "solid-js";
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
    sameData,
    createRead,
} from "@mileniumhq/paperui";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { createSaves } from "../../lib/saves";
import { discardUpload, listAdded, newStage, pickFiles, stageFolder } from "../../lib/addons/upload";
import { type SourceGameSpec, type SourceModView } from "./index";
import type { SourcePlugin } from "./sourcemod";

const SOURCEMOD = "sourcemod";

// SourceMod on a Source server: one switch for it, then its plugins, each
// turned on or off where SourceMod keeps them. There is no catalog that
// checks what it lists, so plugins come as .smx files the user uploads.
export default function SourceMods(props: { spec: SourceGameSpec; active: boolean }) {
    const { calls, files, serverStatus } = useServer();
    const upload = pickFiles(files, "Upload plugins", ["smx"]);
    const discard = discardUpload(calls);
    // read while the tab is open, and again as the server starts or stops; a save's answer wins over a read sent before it
    const mods = createRead((): Promise<SourceModView> => calls.sourceSourcemod(), { source: () => props.active && serverStatus(), message: errorMessage });
    const view = mods.value;
    // a read again clears the failure at once, as it starts
    const loadError = () => (mods.loading() ? null : mods.error());
    const [working, setWorking] = createSignal<string | null>(null);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const [notice, setNotice] = createSignal("");
    const [removing, setRemoving] = createSignal<SourcePlugin | null>(null);
    // the plugin stays named while its dialog closes
    const shownRemoving = createMemo<SourcePlugin | null>((prev) => removing() ?? prev, null);

    // SourceMod's switch and each plugin's flip at once; their saves, the
    // removals and the uploads run one at a time, so none races another
    const saves = createSaves({
        failed: (err, key, on) => {
            const what = key === SOURCEMOD ? "SourceMod" : (view()?.plugins.find((plugin) => plugin.file === key)?.title ?? key);
            setError({ title: `${what} did not turn ${on ? "on" : "off"}`, message: errorMessage(err) });
        },
        changed: () => {
            setError(null);
            setNotice("");
        },
    });
    /** saves through `work`, and on a failure shows whatever did land */
    const answer = async (work: () => Promise<SourceModView>) => {
        try {
            mods.set(await work());
        } catch (err) {
            await mods.reload();
            throw err;
        }
    };
    // turning SourceMod on the first time downloads it, which can take a while
    const sourcemod = saves.setting(SOURCEMOD, () => view()?.on ?? false, (on) =>
        answer(() => calls.sourceSourcemodSet({ on })),
    );
    const pluginSetting = (file: string, enabled: () => boolean) =>
        saves.setting(file, enabled, (on) => answer(() => calls.sourcePlugin({ file, on })));

    const remove = async (plugin: SourcePlugin) => {
        setWorking(plugin.file);
        setError(null);
        setNotice("");
        try {
            await saves.run(() => answer(() => calls.sourcePluginRemove({ file: plugin.file })));
            setRemoving(null);
        } catch (err) {
            setError({ title: `${plugin.title} was not removed`, message: errorMessage(err) });
        } finally {
            setWorking(null);
        }
    };
    const uploadPlugins = async () => {
        const stage = newStage();
        setWorking("upload");
        setError(null);
        setNotice("");
        try {
            const picked = await upload.pick(stageFolder(stage));
            if (picked.status === "canceled") {
                await discard(stage);
                return;
            }
            const { added, view: next } = await saves.run(() =>
                calls.sourcePluginUpload({ stage }),
            );
            mods.set(next);
            setNotice(`${listAdded(added)} ${added.length === 1 ? "is" : "are"} on.`);
        } catch (err) {
            setError({ title: "Plugins not added", message: errorMessage(err) });
            // quiet: the upload's own failure is on screen; a stage left behind holds no user data
            await discard(stage).catch((cleanup) => console.error(`[Mods] Failed to discard upload ${stage}:`, cleanup));
            await mods.reload();
        } finally {
            setWorking(null);
        }
    };
    // a plugin is the row of its file: a save's answer brings new objects, and the rows stay
    const pluginFiles = createMemo(() => (view()?.plugins ?? []).map((plugin) => plugin.file), undefined, { equals: sameData });
    const pluginOf = (file: string) => view()?.plugins.find((plugin) => plugin.file === file);

    const restart = () => {
        const current = view();
        return !!current && serverStatus() !== "offline" && current.on !== current.active;
    };
    const live = () => !!view()?.active;
    const status = () => {
        if (sourcemod.saving()) return sourcemod.value() ? "Downloading and turning on…" : "Turning off…";
        return view()?.on ? "Metamod:Source and SourceMod load with the server." : "Admin commands, map votes and plugins, by AlliedModders.";
    };

    return (
        <>
            <PaperPageHeader icon="extension" title="Mods">
                <Show when={view()?.on && !view()?.missing}>
                    <PaperButton disabled={working() !== null || sourcemod.saving()} onClick={() => void uploadPlugins()}>
                        <PaperIcon aria-hidden="true">{working() === "upload" ? "hourglass_top" : upload.icon}</PaperIcon>
                        {upload.label}
                    </PaperButton>
                </Show>
            </PaperPageHeader>

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read SourceMod">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void mods.reload()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={view()}>
                {(current) => (
                    <PaperFlex direction="column" gap="full">
                        <PaperSettingList autoHeight>
                            <PaperSettingItem title="SourceMod" description={status()}>
                                <PaperToggle checked={sourcemod.value()} onChange={sourcemod.set} />
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
                        {/* the plugins go with SourceMod the moment its switch turns off */}
                        <Show when={current().on && sourcemod.value() && !current().missing}>
                            <PaperText size={2} weight={700} color="text-subtle">Plugins</PaperText>
                            <PaperSettingList autoHeight>
                                <For each={pluginFiles()}>
                                    {(file) => {
                                        const plugin = () => pluginOf(file)!;
                                        const enabled = pluginSetting(file, () => plugin().enabled);
                                        return (
                                            <PaperSettingItem title={plugin().title} description={plugin().bundled ? plugin().description : `${file} · ${plugin().description}`}>
                                                <PaperFlex direction="row" gap="half" align="center">
                                                    <Show when={!plugin().bundled}>
                                                        <PaperButton variant="text" disabled={working() !== null} onClick={() => setRemoving(plugin())}>
                                                            Remove
                                                        </PaperButton>
                                                    </Show>
                                                    <PaperToggle checked={enabled.value()} aria-label={`${plugin().title} on`} onChange={enabled.set} />
                                                </PaperFlex>
                                            </PaperSettingItem>
                                        );
                                    }}
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
                title={`Remove ${shownRemoving()?.title}`}
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
                    {shownRemoving()?.file} is deleted from the server. Its settings in cfg/sourcemod stay.
                </PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()!.message}</PaperText>
                </Show>
            </PaperModal>
        </>
    );
}
