import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperGrid, PaperInput, PaperModal, PaperQuote, PaperStatTile, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { CALLS } from "../../service/contract";
import { palworld } from "./index";
import type { PalworldMetrics } from "./rest";
import { fpsTone, TARGET_FPS, uptimeLabel } from "./health";

const DESCRIPTION = "ServerDescription";
const METRICS_MS = 5_000;

export default function PalworldOverview() {
    const description = () => String(gameSettings()[DESCRIPTION] ?? "");
    const [open, setOpen] = createSignal(false);
    const [draft, setDraft] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");
    const [pending, setPending] = createSignal(false);
    const edit = () => { setDraft(description()); setError(""); setOpen(true); };
    const save = async () => {
        setSaving(true);
        setError("");
        try {
            await serverBridge.call(CALLS.writeGameOptions, { patch: { [DESCRIPTION]: draft().trim() } });
            setPending(serverStatus() !== "offline");
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const [metrics, setMetrics] = createSignal<PalworldMetrics>();
    const [metricsError, setMetricsError] = createSignal("");
    // the server is asked for its health while it runs; the numbers are gone when it stops
    createEffect(on(serverStatus, (status) => {
        setMetrics(undefined);
        setMetricsError("");
        if (status !== "online") return;
        const load = () => serverBridge.call<PalworldMetrics>("palworld-metrics").then(
            (answer) => { setMetrics(answer); setMetricsError(""); },
            (err) => setMetricsError(errorMessage(err)),
        );
        void load();
        const timer = setInterval(() => void load(), METRICS_MS);
        onCleanup(() => clearInterval(timer));
    }));

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={palworld.art.icon} alt="Palworld" fallbackIcon="pets" />}
            detail={
                <EditableDetail edit="Edit description" onEdit={edit}>
                    <Show when={description()} fallback={<PaperText color="text-subtle">No description</PaperText>}>
                        <PaperText color="text-subtle">{description()}</PaperText>
                    </Show>
                </EditableDetail>
            }
            software="Steam"
            control={palworld.describe({ software: "", version: "" }).control}
        >
            <Show when={metrics()}>
                {(health) => (
                    <PaperGrid min="field">
                        <PaperStatTile icon="speed" label="Server FPS" value={Math.round(health().serverfpsaverage)} tone={fpsTone(health().serverfpsaverage)} meter={{ value: Math.min(health().serverfpsaverage, TARGET_FPS), max: TARGET_FPS }} />
                        <PaperStatTile icon="group" label="Players" value={`${health().currentplayernum} / ${health().maxplayernum}`} />
                        <PaperStatTile icon="home_work" label="Base camps" value={health().basecampnum} />
                        <PaperStatTile icon="wb_sunny" label="In-game days" value={health().days} />
                        <PaperStatTile icon="schedule" label="Uptime" value={uptimeLabel(health().uptime)} />
                    </PaperGrid>
                )}
            </Show>
            <Show when={metricsError()}>
                <PaperQuote variant="danger" icon="warning" title="Server health unavailable">{metricsError()}</PaperQuote>
            </Show>

            <Show when={pending()}>
                <PaperQuote variant="warning" icon="info" title="Description saved" onDismiss={() => setPending(false)}>
                    The server list shows it after the server restarts.
                </PaperQuote>
            </Show>

            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Description"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" disabled={saving() || draft().trim() === description()} onClick={() => void save()}>
                            {saving() ? "Saving..." : "Save"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">Shown under the server's name in Palworld's server list.</PaperText>
                <PaperInput
                    label="Description"
                    fullWidth
                    value={draft()}
                    maxLength={256}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !saving() && draft().trim() !== description()) void save(); }}
                />
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Description not saved">{error()}</PaperQuote>
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
