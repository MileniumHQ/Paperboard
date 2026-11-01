import { createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { listAdded } from "../../lib/addons/upload";
import { changeMessage, requiredChain, workshopModsKind, type ModChange } from "../../lib/addons/workshop";
import AddonBrowser from "../../components/addons/AddonBrowser";
import type { InstallExtrasProps } from "../../components/addons/AddonModals";
import { createAddonBrowser } from "../../components/addons/state";

// What installing a mod also installs: the Workshop items it requires, and
// what those require. The service skips the ones already installed, and
// checks each file's own references before anything is placed.
function RequiredMods(props: InstallExtrasProps) {
    const [titles, setTitles] = createSignal<string[] | null>(null);
    const [error, setError] = createSignal("");
    const required = () => props.target.dependencies ?? [];

    createEffect(
        on(
            () => props.target.projectId,
            () => {
                const ids = required();
                setTitles(null);
                setError("");
                props.report({ ready: ids.length === 0, payload: ids });
                if (ids.length === 0) return;
                const own = props.target.projectId;
                requiredChain(ids)
                    .then((items) => {
                        if (props.target.projectId !== own) return;
                        setTitles(items.map((i) => i.title));
                        props.report({ ready: true, payload: ids });
                    })
                    .catch((err) => {
                        if (props.target.projectId !== own) return;
                        console.error(`[Mods] Failed to look up what "${props.target.title}" requires:`, err);
                        setError(errorMessage(err));
                    });
            },
        ),
    );

    return (
        <>
            <Show when={required().length > 0 && !titles() && !error()}>
                <PaperText size={2} color="text-subtle">
                    Resolving dependencies...
                </PaperText>
            </Show>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't resolve its dependencies">
                    {error()}
                </PaperQuote>
            </Show>
            <Show when={titles()?.length}>
                <PaperText size={3} weight={700}>
                    Also installs (required)
                </PaperText>
                <For each={titles()!}>{(title) => <PaperText size={3}>{title}</PaperText>}</For>
                <PaperText size={2} color="text-subtle">
                    Mods already on the server are kept as they are.
                </PaperText>
            </Show>
        </>
    );
}

// Mods on a tModLoader server: the shared add-on browser over tModLoader/Mods,
// filled from the Steam Workshop, plus updating every Workshop mod at once.
export default function TerrariaMods(props: { active: boolean }) {
    const [notice, setNotice] = createSignal<{ title: string; message: string } | null>(null);
    const browser = createAddonBrowser({
        kind: workshopModsKind,
        active: () => props.active,
        installed: (outcome) => {
            const { result, restart } = outcome as ModChange<string[]>;
            setNotice({ title: "Installed", message: changeMessage(`${listAdded(result)} ${result.length === 1 ? "is" : "are"} on.`, restart) });
        },
        removed: () => setNotice(null),
    });

    const [updating, setUpdating] = createSignal(false);
    const [updateError, setUpdateError] = createSignal("");
    const update = async () => {
        setUpdating(true);
        setUpdateError("");
        setNotice(null);
        try {
            const { result, restart } = await serverBridge.call<ModChange<{ updated: string[]; current: number }>>(
                "terraria-mod-updates",
                {},
                { timeoutMs: null },
            );
            setNotice(
                result.updated.length > 0
                    ? { title: "Updated", message: changeMessage(`${listAdded(result.updated)} updated.`, restart) }
                    : { title: "Up to date", message: result.current > 0 ? "Every Workshop mod is on its latest upload." : "No mods from the Workshop are installed." },
            );
            await browser.reload();
        } catch (err) {
            console.error("[Mods] Update failed:", err);
            setUpdateError(errorMessage(err));
        } finally {
            setUpdating(false);
        }
    };

    return (
        <AddonBrowser
            browser={browser}
            installExtras={RequiredMods}
            actions={
                <PaperEffect variant="primary">
                    <PaperButton disabled={updating() || browser.busy()} onClick={() => void update()}>
                        <PaperIcon>sync</PaperIcon>
                        {updating() ? "Updating…" : "Update mods"}
                    </PaperButton>
                </PaperEffect>
            }
            notices={
                <>
                    <Show when={updateError()}>
                        <PaperQuote variant="danger" icon="warning" title="Mods not updated">
                            {updateError()}
                        </PaperQuote>
                    </Show>
                    <Show when={notice()}>
                        {(note) => (
                            <PaperQuote variant="success" icon="check_circle" title={note().title}>
                                {note().message}
                            </PaperQuote>
                        )}
                    </Show>
                </>
            }
        />
    );
}
