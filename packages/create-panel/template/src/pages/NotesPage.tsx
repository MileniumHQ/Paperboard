// A page that keeps something: the panel's config, saved under its own id.
// A read or write that fails is said, with the reason, never dropped.
import { createSignal, onMount, Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperInput, PaperPageHeader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { config } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../panel";
import { errorMessage } from "../lib/failure";

interface PanelConfig {
    note?: string;
}

export default function NotesPage() {
    const [note, setNote] = createSignal("");
    const [saved, setSaved] = createSignal(false);
    const [failure, setFailure] = createSignal<{ title: string; message: string } | null>(null);

    onMount(async () => {
        try {
            const stored = await config.get<PanelConfig>(PANEL_ID);
            if (typeof stored?.note === "string") setNote(stored.note);
        } catch (err) {
            console.error("[Notes] saved note read failed:", err);
            setFailure({ title: "Saved note not loaded", message: errorMessage(err) });
        }
    });

    const save = async () => {
        setFailure(null);
        setSaved(false);
        try {
            // read, change, write: other keys in the config survive the save
            const stored = await config.get<PanelConfig>(PANEL_ID);
            await config.set({ ...(stored ?? {}), note: note() }, PANEL_ID);
            setSaved(true);
        } catch (err) {
            console.error("[Notes] note save failed:", err);
            setFailure({ title: "Note not saved", message: errorMessage(err) });
        }
    };

    return (
        <>
            <PaperPageHeader icon="edit" title="Notes" subtitle="Kept in the panel's config under its id" />
            <Show when={failure()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="warning" title={shown().title} role="alert" onDismiss={() => setFailure(null)}>
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
            <PaperCard>
                <PaperFlex direction="column" padding="full" gap="full">
                    <PaperInput
                        fullWidth
                        label="Note"
                        placeholder="Write something worth keeping"
                        value={note()}
                        onInput={(e) => {
                            setNote(e.currentTarget.value);
                            setSaved(false);
                        }}
                    />
                    <PaperFlex direction="row" gap="half" align="center">
                        <PaperButton onClick={() => void save()}>Save note</PaperButton>
                        <Show when={saved()}>
                            <PaperText size={2} color="text-subtle">
                                Saved.
                            </PaperText>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
        </>
    );
}
