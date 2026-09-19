import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperButton,
    PaperInput,
    PaperText,
    PaperQuote,
} from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";

const PANEL_ID = "dev.paperboard.ai";

export default function NotesPage() {
    const [note, setNote] = createSignal("");
    const [saved, setSaved] = createSignal(false);
    const [error, setError] = createSignal("");

    onMount(async () => {
        try {
            const stored = await config.get<any>(PANEL_ID);
            if (typeof stored?.note === "string") setNote(stored.note);
        } catch (err) {
            console.error("[Notes] saved note read failed:", err);
            setError("Could not load the saved note.");
        }
    });

    const save = async () => {
        setError("");
        setSaved(false);
        try {
            // read-modify-write through the panel id so sibling keys set by
            // other pages survive the save
            const stored = await config.get<any>(PANEL_ID);
            await config.set({ ...(stored ?? {}), note: note() }, PANEL_ID);
            setSaved(true);
        } catch (err) {
            console.error("[Notes] note save failed:", err);
            setError("Could not save the note. Try again.");
        }
    };

    return (
        <PaperFlex direction="column" gap="half" padding="full">
            <PaperText preset="title">Notes</PaperText>
            <PaperText preset="body">
                Persists through the panel config under this panel's id.
            </PaperText>
            <PaperInput
                fullWidth
                placeholder="Write something worth keeping..."
                value={note()}
                onInput={(e) => {
                    setNote(e.currentTarget.value);
                    setSaved(false);
                }}
            />
            <PaperFlex direction="row" gap="half" align="center">
                <PaperButton size="small" onClick={() => void save()}>
                    Save note
                </PaperButton>
                <Show when={saved()}>
                    <PaperText size={2} color="light-text">
                        Saved.
                    </PaperText>
                </Show>
            </PaperFlex>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Error">
                    {error()}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}
