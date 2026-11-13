import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperInput, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { CALLS } from "../../service/contract";
import { palworld } from "./index";
import type { PalworldMetrics } from "./rest";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { fpsTone } from "./health";

const DESCRIPTION = "ServerDescription";

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

    const metrics = createMetrics<PalworldMetrics>("palworld-metrics");
    const uptime = createUptime();

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
            stats={metrics.value() && overviewStats(
                uptime(),
                { icon: "speed", label: "Server FPS", value: String(Math.round(metrics.value()!.serverfpsaverage)), tone: fpsTone(metrics.value()!.serverfpsaverage) },
                { icon: "wb_sunny", label: "In-game days", value: String(metrics.value()!.days) },
            )}
        >
            <Show when={metrics.error()}>
                <PaperQuote variant="danger" icon="warning" title="Server health unavailable">{metrics.error()}</PaperQuote>
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
