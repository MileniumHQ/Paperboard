import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperFlex, PaperInput, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { ACTION_IDS } from "../../service/contract";
import { palworld } from "./index";

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
            await serverBridge.call(ACTION_IDS.writeGameOptions, { patch: { [DESCRIPTION]: draft().trim() } });
            setPending(serverStatus() !== "offline");
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={palworld.art.icon} alt="Palworld" fallbackIcon="pets" />}
            detail={
                <PaperFlex direction="row" gap="half" align="center">
                    <Show when={description()} fallback={<PaperText color="text-subtle">No description</PaperText>}>
                        <PaperText color="text-subtle">{description()}</PaperText>
                    </Show>
                    <PaperButton size="tiny" icon onClick={edit} title="Edit description" aria-label="Edit description">
                        edit
                    </PaperButton>
                </PaperFlex>
            }
            software="Steam"
            control={palworld.describe({ software: "", version: "" }).control}
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
