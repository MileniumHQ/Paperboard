// New project, the same from the home screen and the editor: an empty
// canvas, or one of the templates. A template built from another panel's
// blocks is offered once the registry says that panel has them, and says
// what it needs when it doesn't. What fails is a toast over the dialog, which
// stays open to try again.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperModal, PaperSelector, PaperSelectorItem, createRead, showError } from "@mileniumhq/paperui";
import { blocksApi } from "@mileniumhq/paperapi";
import { TEMPLATES, readChoices, type Built } from "../templates";
import type { SavedFlows } from "../panel";

const EMPTY = "empty";

export function NewProjectModal(props: {
    open: boolean;
    /** makes the project: a template's name and flows, or none for an empty one */
    onCreate: (made: { name?: string; flows?: SavedFlows }) => Promise<unknown>;
    onClose: () => void;
}) {
    const [chosen, setChosen] = createSignal(EMPTY);
    const [busy, setBusy] = createSignal(false);
    // what the registry offers, read each time the dialog opens
    const registry = createRead(
        async () => {
            const [entries, projects] = await Promise.all([blocksApi.list(), blocksApi.projects()]);
            return { entries, projects, choices: await readChoices(entries, (typeRef) => blocksApi.typeChoices(typeRef)) };
        },
        { source: () => props.open },
    );
    createEffect(on(() => props.open, (open) => {
        if (!open) return;
        setChosen(EMPTY);
        setBusy(false);
    }));

    /** What a template makes now, or null while the registry it needs is being read. */
    const built = (id: string): Built | null => {
        const template = TEMPLATES.find((t) => t.id === id)!;
        if (!template.needsRegistry) return template.build({ entries: [], projects: [], choices: {} });
        const answer = registry.value();
        return answer ? template.build(answer) : null;
    };

    const submit = async () => {
        if (busy()) return;
        setBusy(true);
        try {
            const id = chosen();
            if (id === EMPTY) await props.onCreate({});
            else {
                const made = built(id);
                if (!made) throw new Error("The blocks it needs are still being looked for");
                if ("unavailable" in made) throw new Error(made.unavailable);
                await props.onCreate({ name: TEMPLATES.find((t) => t.id === id)!.name, flows: made.flows });
            }
            props.onClose();
        } catch (err) {
            showError("Couldn't make the project", err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="New project"
            size="medium"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="success" disabled={busy()} onClick={() => void submit()}>Create</PaperButton>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperSelector name="blocks-new-project" value={chosen()} onValueChange={(value) => setChosen(String(value))}>
                    <PaperSelectorItem value={EMPTY} icon="extension" description="An empty canvas to build on">Empty project</PaperSelectorItem>
                    <For each={TEMPLATES}>
                        {(template) => {
                            // built once per answer of the registry, not once per read of it
                            const made = createMemo(() => built(template.id));
                            const why = () => {
                                const answer = made();
                                return answer && "unavailable" in answer ? answer.unavailable : null;
                            };
                            return (
                                <PaperSelectorItem value={template.id} icon={template.icon} description={why() ?? template.description} disabled={made() === null || why() !== null}>
                                    {template.name}
                                </PaperSelectorItem>
                            );
                        }}
                    </For>
                </PaperSelector>
                <Show when={registry.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't look for the blocks the templates need"
                            error={err()}
                            action={{ label: "Try again", disabled: registry.loading(), onClick: () => void registry.reload() }}
                        />
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
