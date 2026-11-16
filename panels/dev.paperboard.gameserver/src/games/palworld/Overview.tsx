import { createSignal, Show } from "solid-js";
import { createAction, createFailureToast, PaperAvatar, PaperButton, PaperInput, PaperModal, PaperQuote, PaperText, showError } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { palworld } from "./index";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { fpsTone } from "./health";

const DESCRIPTION = "ServerDescription";

export default function PalworldOverview() {
    const { calls, gameSettings, serverStatus } = useServer();
    const description = () => String(gameSettings()[DESCRIPTION] ?? "");
    const [open, setOpen] = createSignal(false);
    const [draft, setDraft] = createSignal("");
    const saving = createAction({ message: errorMessage });
    const [pending, setPending] = createSignal(false);
    const edit = () => { setDraft(description()); setOpen(true); };
    // a failure is a toast over the dialog, which stays open to try again
    const save = () => saving.run("Couldn't save the description", async () => {
        await calls.writeGameOptions({ patch: { [DESCRIPTION]: draft().trim() } });
        setPending(serverStatus() !== "offline");
        setOpen(false);
    }, (failure) => failure && showError(failure.title, failure.message));

    const metrics = createMetrics(calls.palworldMetrics);
    createFailureToast(metrics.error, { title: "Couldn't read the server's health" });
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
            </PaperModal>
        </ServerOverview>
    );
}
