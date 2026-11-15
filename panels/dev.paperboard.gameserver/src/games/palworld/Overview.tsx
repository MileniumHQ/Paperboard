import { createSignal, Show } from "solid-js";
import { createAction, PaperAvatar, PaperButton, PaperInput, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { gameSettings, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { palworld } from "./index";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { fpsTone } from "./health";
import { serverCalls } from "../../lib/api";

const DESCRIPTION = "ServerDescription";

export default function PalworldOverview() {
    const description = () => String(gameSettings()[DESCRIPTION] ?? "");
    const [open, setOpen] = createSignal(false);
    const [draft, setDraft] = createSignal("");
    const saving = createAction({ message: errorMessage });
    const [pending, setPending] = createSignal(false);
    const edit = () => { setDraft(description()); saving.setError(null); setOpen(true); };
    const save = () => saving.run("Description not saved", async () => {
        await serverCalls.writeGameOptions({ patch: { [DESCRIPTION]: draft().trim() } });
        setPending(serverStatus() !== "offline");
        setOpen(false);
    });

    const metrics = createMetrics(serverCalls.palworldMetrics);
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
                        <PaperButton variant="primary" disabled={saving.busy() || draft().trim() === description()} onClick={() => void save()}>
                            {saving.busy() ? "Saving..." : "Save"}
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
                    onKeyDown={(e) => { if (e.key === "Enter" && !saving.busy() && draft().trim() !== description()) void save(); }}
                />
                <Show when={saving.error()}>
                    {(failure) => <PaperQuote variant="danger" icon="warning" title={failure().title}>{failure().message}</PaperQuote>}
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
