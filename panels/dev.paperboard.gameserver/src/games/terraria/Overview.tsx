import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperIcon, PaperQuote } from "@mileniumhq/paperui";
import ServerOverview from "../../components/ServerOverview";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { terraria } from "./index";

export default function TerrariaOverview() {
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal("");

    const save = async () => {
        setSaving(true);
        setSaveError("");
        try {
            await serverBridge.call("terraria-save", undefined, { timeoutMs: null });
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={terraria.art.poster} alt="Terraria" fallbackIcon="landscape" />}
            software="Vanilla"
            actions={
                <PaperButton onClick={() => void save()} disabled={saving()}>
                    <PaperIcon>save</PaperIcon>
                    {saving() ? "Saving..." : "Save world"}
                </PaperButton>
            }
        >
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="World not saved" onDismiss={() => setSaveError("")}>
                    {saveError()}
                </PaperQuote>
            </Show>
        </ServerOverview>
    );
}
