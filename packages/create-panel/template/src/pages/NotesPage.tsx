// A page that keeps something: the panel's config, saved under its own id.
// A read or write that fails is said in a toast, with the reason, never dropped.
import { createSignal, Match, Show, Switch } from "solid-js";
import {
    createRead,
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperInput,
    PaperLoader,
    PaperPageHeader,
    PaperText,
    showError,
} from "@mileniumhq/paperui";
import { config } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../panel";

interface PanelConfig {
    note?: string;
}

export default function NotesPage() {
    const [note, setNote] = createSignal("");
    const [saved, setSaved] = createSignal(false);

    // the saved note, read once: until it is, there is nothing to edit
    const stored = createRead(
        async () => {
            const read = await config.get<PanelConfig>(PANEL_ID);
            setNote(typeof read?.note === "string" ? read.note : "");
            return true;
        },
        { failure: { title: "Couldn't load the note" } },
    );

    const save = async () => {
        setSaved(false);
        try {
            // read, change, write: other keys in the config survive the save
            const read = await config.get<PanelConfig>(PANEL_ID);
            await config.set({ ...(read ?? {}), note: note() }, PANEL_ID);
            setSaved(true);
        } catch (err) {
            showError("Couldn't save the note", err, { retry: () => void save() });
        }
    };

    return (
        <>
            <PaperPageHeader icon="edit" title="Notes" subtitle="Kept in the panel's config under its id" />
            <Switch>
                <Match when={stored.value()}>
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
                </Match>
                <Match when={stored.error()}>
                    <PaperEmptyState icon="error" title="Couldn't load">
                        <PaperButton disabled={stored.loading()} onClick={() => void stored.reload()}>
                            Try again
                        </PaperButton>
                    </PaperEmptyState>
                </Match>
                <Match when={true}>
                    <PaperLoader loaderStatus="indeterminate" label="Reading the note" />
                </Match>
            </Switch>
        </>
    );
}
