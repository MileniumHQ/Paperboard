import { batch, createEffect, createSignal, For, on, Show } from "solid-js";
import {
    PaperButton,
    PaperCheckbox,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperQuote,
    PaperText,
    type PaperFileReveal,
    createLatest,
} from "@mileniumhq/paperui";
import { serverVersion } from "../lib/server";
import { locateAddonConfig } from "../lib/files";
import { errorMessage } from "../lib/failure";
import {
    checkPluginUpdates,
    pluginVersionWarning,
    previewInstall,
    uninstallPlugin,
    updatePlugin,
    type InstallPreview,
    type PluginUpdateCheck,
} from "../lib/plugins";
import { pluginsKind } from "../lib/addons/plugins";
import AddonBrowser from "./addons/AddonBrowser";
import type { DetailExtras } from "./addons/AddonDetail";
import type { InstallExtrasProps } from "./addons/AddonModals";
import { createAddonBrowser } from "./addons/state";

const versionNote = (dep: { file?: unknown; versionNumber: string; gameVersions: string[]; unresolvableReason?: string }) =>
    dep.file
        ? `v${dep.versionNumber || "?"}${dep.gameVersions.length > 0 ? ` · ${dep.gameVersions.join(", ")}` : ""}`
        : (dep.unresolvableReason ?? "Could not resolve");

// What installing a build also installs: its required dependencies, the
// optional ones to tick, and what clashes. Nothing installs until it resolves.
function DependencyPreview(props: InstallExtrasProps) {
    const [preview, setPreview] = createSignal<InstallPreview | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [optional, setOptional] = createSignal<string[]>([]);
    const [error, setError] = createSignal("");

    // a quick reselection must not show an older answer
    const latest = createLatest();
    createEffect(
        on([() => props.version?.id, optional], ([versionId, checked]) => {
            setPreview(null);
            setError("");
            props.report({ ready: false, payload: checked });
            setLoading(!!versionId);
            const current = latest();
            if (!versionId) return;
            previewInstall(props.target.projectId, props.target.title, versionId, checked).then(
                (next) => {
                    if (!current()) return;
                    batch(() => {
                        setPreview(next);
                        setLoading(false);
                    });
                    props.report({ ready: !!next.mainFile && next.failures.length === 0, payload: checked });
                },
                (err) => {
                    if (!current()) return;
                    console.error(`[Plugins] Failed to resolve the dependencies of "${props.target.title}":`, err);
                    batch(() => {
                        setError(errorMessage(err));
                        setLoading(false);
                    });
                },
            );
        }),
    );

    return (
        <>
            <Show when={loading()}>
                <PaperText size={2} color="text-subtle">
                    Resolving dependencies...
                </PaperText>
            </Show>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't resolve its dependencies">
                    {error()}
                </PaperQuote>
            </Show>
            <Show when={!loading() && preview()}>
                {(plan) => (
                    <>
                        <Show when={!plan().mainFile}>
                            <PaperQuote variant="danger" icon="warning" title="Nothing to install">
                                This version has no file Paperboard can verify, so it is not installed.
                            </PaperQuote>
                        </Show>
                        <Show when={plan().failures.length > 0}>
                            <PaperQuote variant="danger" icon="warning" title="Can't install this version">
                                {plan().failures.join(" ")}
                            </PaperQuote>
                        </Show>
                        <Show when={!plan().matchesServer}>
                            <PaperQuote variant="warning" icon="warning" title="Different Minecraft version">
                                {pluginVersionWarning(plan().gameVersions, serverVersion())}
                            </PaperQuote>
                        </Show>

                        <Show when={plan().required.length > 0}>
                            <PaperText size={3} weight={700}>
                                Also installs (required)
                            </PaperText>
                            <For each={plan().required}>
                                {(dep) => (
                                    <PaperFlex direction="row" justify="space-between" align="center" gap="half" fullWidth>
                                        <PaperText size={3}>{dep.name}</PaperText>
                                        <PaperText size={2} color="text-subtle">
                                            {versionNote(dep)}
                                        </PaperText>
                                    </PaperFlex>
                                )}
                            </For>
                        </Show>

                        <Show when={plan().optional.length > 0}>
                            <PaperText size={3} weight={700}>
                                Optional
                            </PaperText>
                            <For each={plan().optional}>
                                {(dep) => (
                                    <PaperCheckbox
                                        checked={optional().includes(dep.key)}
                                        disabled={!dep.file || props.installing}
                                        onChange={(checked) =>
                                            setOptional((prev) => (checked ? [...prev, dep.key] : prev.filter((k) => k !== dep.key)))
                                        }
                                        label={dep.name}
                                        description={versionNote(dep)}
                                    />
                                )}
                            </For>
                        </Show>

                        <Show when={plan().transitive.length > 0}>
                            <PaperText size={2} color="text-subtle">
                                Also pulls in: {plan().transitive.map((dep) => dep.name).join(", ")}
                            </PaperText>
                        </Show>

                        <Show when={plan().incompatible.length > 0}>
                            <PaperQuote variant="warning" icon="warning" title="Incompatible with this version">
                                Do not install alongside: {plan().incompatible.map((dep) => dep.name).join(", ")}
                            </PaperQuote>
                        </Show>

                        <Show when={plan().embedded.length > 0}>
                            <PaperText size={2} color="text-subtle">
                                Bundled: {plan().embedded.map((dep) => dep.name).join(", ")}
                            </PaperText>
                        </Show>
                    </>
                )}
            </Show>
        </>
    );
}

// Plugins (Mods on a mod loader): the shared add-on browser, plus the
// update check the Versions tab can ask for and the Configure button that
// opens an add-on's settings in the Files tab.
export default function Plugins(props: {
    /** the Versions tab asked, after switching the server jar, for every add-on to be updated */
    updateRequested?: boolean;
    /** the request was taken: it runs once, however often the tab opens */
    onUpdateRequestTaken?: () => void;
    /** opens the Files tab at an add-on's settings */
    onConfigure?: (reveal: PaperFileReveal) => void;
}) {
    const browser = createAddonBrowser({ kind: pluginsKind });
    const unit = () => pluginsKind.noun;

    const [updating, setUpdating] = createSignal(false);
    const [updateError, setUpdateError] = createSignal("");
    const [failures, setFailures] = createSignal<PluginUpdateCheck[] | null>(null);
    const [uninstallingFailure, setUninstallingFailure] = createSignal<string | null>(null);
    // said in the result's dialog, where the Uninstall was pressed
    const [uninstallError, setUninstallError] = createSignal("");
    // what an update that left nothing to report did
    const [updated, setUpdated] = createSignal<{ title: string; message: string } | null>(null);

    const runUpdateCheck = async () => {
        if (updating()) return;
        setUpdating(true);
        setUpdateError("");
        setUpdated(null);
        try {
            const checks = await checkPluginUpdates();
            // nothing that was not updated is dropped silently: no compatible
            // build, a lookup or update that failed, and one with nothing to look up
            const failed: PluginUpdateCheck[] = checks.filter((c) => c.status === "incompatible" || c.status === "error" || c.status === "unchecked");
            const available = checks.filter((c) => c.status === "update-available");
            for (const check of available) {
                try {
                    await updatePlugin(check);
                } catch (err) {
                    console.error(`[Plugins] Failed to update "${check.filename}":`, err);
                    failed.push({ ...check, status: "error", error: errorMessage(err) });
                }
            }
            await browser.reload();
            if (failed.length > 0) {
                setUninstallError("");
                setFailures(failed);
            } else {
                const count = available.length;
                if (checks.length === 0) setUpdated({ title: "Nothing to update", message: `No ${unit()}s are installed.` });
                else if (count === 0) setUpdated({ title: "Up to date", message: `Every ${unit()} is on its latest build.` });
                else setUpdated({ title: "Updated", message: `${count} ${count === 1 ? unit() : `${unit()}s`} updated.` });
            }
        } catch (err) {
            console.error("[Plugins] Update check failed:", err);
            setUpdateError(errorMessage(err));
        } finally {
            setUpdating(false);
        }
    };

    const uninstallFailure = async (filename: string) => {
        setUninstallingFailure(filename);
        setUninstallError("");
        try {
            await uninstallPlugin(filename);
            setFailures((prev) => (prev ?? []).filter((f) => f.filename !== filename));
            await browser.reload();
        } catch (err) {
            console.error(`[Plugins] Failed to uninstall "${filename}":`, err);
            setUninstallError(errorMessage(err));
        } finally {
            setUninstallingFailure(null);
        }
    };

    const withStatus = (status: PluginUpdateCheck["status"]) => (failures() ?? []).filter((f) => f.status === status);
    const incompatible = () => withStatus("incompatible");
    const notUpdated = () => withStatus("error");
    const unchecked = () => withStatus("unchecked");
    const resultTitle = () => {
        if (incompatible().length > 0 || notUpdated().length > 0) return `Couldn't update every ${unit()}`;
        const count = unchecked().length;
        return count === 1 ? `1 ${unit()} wasn't checked` : `${count} ${unit()}s weren't checked`;
    };

    // only what is known to have no build for this server is offered to be removed
    const uninstallIncompatible = async () => {
        for (const failure of incompatible()) await uninstallFailure(failure.filename);
    };

    // the Versions tab hands off here after switching the server jar; a
    // request made while an update runs waits for it, then runs once
    createEffect(
        on([() => props.updateRequested, updating], ([requested, busy]) => {
            if (!requested || busy) return;
            props.onUpdateRequestTaken?.();
            void runUpdateCheck();
        }),
    );

    // made per opened add-on, so a message about one never shows on the next
    const configure: DetailExtras = (entry, close) => {
        const [configuring, setConfiguring] = createSignal(false);
        const [error, setError] = createSignal("");
        const open = async () => {
            setError("");
            setConfiguring(true);
            try {
                const location = await locateAddonConfig(entry.id);
                if (!location.reveal) {
                    setError(location.message ?? "Paperboard could not find where this keeps its settings.");
                    return;
                }
                close();
                props.onConfigure?.(location.reveal);
            } catch (err) {
                console.error(`[Plugins] Failed to locate the settings of "${entry.id}":`, err);
                setError(errorMessage(err));
            } finally {
                setConfiguring(false);
            }
        };
        return {
            actions: (
                <PaperButton disabled={browser.busy() || configuring()} onClick={() => void open()}>
                    <PaperIcon>{configuring() ? "hourglass_top" : "settings"}</PaperIcon>
                    Configure
                </PaperButton>
            ),
            notice: (
                <Show when={error()}>
                    <PaperQuote variant="warning" icon="settings" title="Couldn't open its settings">
                        {error()}
                    </PaperQuote>
                </Show>
            ),
        };
    };

    return (
        <AddonBrowser
            browser={browser}
            installExtras={DependencyPreview}
            detailExtras={configure}
            actions={
                <PaperEffect variant="primary">
                    <PaperButton disabled={updating()} onClick={() => void runUpdateCheck()}>
                        <PaperIcon>sync</PaperIcon>
                        {updating() ? "Updating…" : `Update ${unit()}s`}
                    </PaperButton>
                </PaperEffect>
            }
            notices={
                <>
                    <Show when={updateError()}>
                        <PaperQuote variant="danger" icon="warning" title={`${unit()[0]!.toUpperCase()}${unit().slice(1)}s not updated`}>
                            {updateError()}
                        </PaperQuote>
                    </Show>
                    <Show when={updated()}>
                        {(done) => (
                            <PaperQuote variant="success" icon="check_circle" title={done().title} onDismiss={() => setUpdated(null)}>
                                {done().message}
                            </PaperQuote>
                        )}
                    </Show>
                </>
            }
        >
            <PaperModal
                open={failures() !== null && failures()!.length > 0}
                onClose={() => setFailures(null)}
                title={resultTitle()}
                size="medium"
                footer={
                    <>
                        <Show when={incompatible().length > 1}>
                            <PaperButton variant="danger" disabled={uninstallingFailure() !== null} onClick={() => void uninstallIncompatible()}>
                                Uninstall incompatible
                            </PaperButton>
                        </Show>
                        <PaperButton onClick={() => setFailures(null)}>Close</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <Show when={uninstallError()}>
                        <PaperQuote variant="danger" icon="warning" title="Not uninstalled" onDismiss={() => setUninstallError("")}>
                            {uninstallError()}
                        </PaperQuote>
                    </Show>
                    <Show when={incompatible().length > 0}>
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="heading">No compatible build</PaperText>
                            <PaperText preset="body">
                                These {unit()}s have no build for your server's software and Minecraft version. They may crash the server on startup.
                                Uninstall the ones you no longer need.
                            </PaperText>
                            <For each={incompatible()}>
                                {(failure) => (
                                    <PaperFlex direction="row" justify="space-between" align="center" gap="half" fullWidth>
                                        <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                                            <PaperText size={3} weight={600} breakWord>
                                                {failure.title}
                                            </PaperText>
                                            <PaperText size={2} color="text-subtle">
                                                Latest targets {failure.latest?.gameVersions.join(", ") || "another version"}
                                            </PaperText>
                                        </PaperFlex>
                                        <PaperButton
                                            variant="danger"
                                            disabled={uninstallingFailure() === failure.filename}
                                            onClick={() => void uninstallFailure(failure.filename)}
                                        >
                                            <PaperIcon>delete</PaperIcon>
                                            Uninstall
                                        </PaperButton>
                                    </PaperFlex>
                                )}
                            </For>
                        </PaperFlex>
                    </Show>
                    <Show when={notUpdated().length > 0}>
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="heading">Not updated</PaperText>
                            <For each={notUpdated()}>
                                {(failure) => (
                                    <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                                        <PaperText size={3} weight={600} breakWord>
                                            {failure.title}
                                        </PaperText>
                                        <PaperText preset="error" breakWord>
                                            {failure.error ?? "The update failed without saying why."}
                                        </PaperText>
                                    </PaperFlex>
                                )}
                            </For>
                        </PaperFlex>
                    </Show>
                    <Show when={unchecked().length > 0}>
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="heading">Not checked</PaperText>
                            <PaperText preset="body">
                                Paperboard looks for updates on Modrinth, and these {unit()}s weren't installed from there, so it can't tell if
                                a newer build exists. They stay as they are.
                            </PaperText>
                            <For each={unchecked()}>
                                {(failure) => (
                                    <PaperText size={3} weight={600} breakWord>
                                        {failure.title}
                                    </PaperText>
                                )}
                            </For>
                        </PaperFlex>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </AddonBrowser>
    );
}
