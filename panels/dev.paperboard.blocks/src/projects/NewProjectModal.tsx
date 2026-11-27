// New project, the same from the home screen and the editor: an empty
// canvas, or one of the templates. Blocks' own are there at once; a panel's
// shows once the registry is read, and says what it needs while it can't be
// made. What fails is a toast over the dialog, which stays open to try again.
import { createEffect, createMemo, createSignal, Index, on, Show } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperModal, PaperSelector, PaperSelectorItem, createRead, showError } from "@mileniumhq/paperui";
import { blocksApi, panelsApi } from "@mileniumhq/paperapi";
import { OWN_TEMPLATES, readChoices, registeredTemplate, type Template } from "../templates";
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
            const [entries, projects, templates, panels] = await Promise.all([blocksApi.list(), blocksApi.projects(), blocksApi.templates(), panelsApi.list()]);
            const panelNames = Object.fromEntries(panels.map((p) => [p.id, p.name]));
            return { entries, projects, templates, panelNames, choices: await readChoices(templates, (typeRef) => blocksApi.typeChoices(typeRef)) };
        },
        { source: () => props.open },
    );
    const templates = createMemo((): Template[] => {
        const answer = registry.value();
        return [...OWN_TEMPLATES, ...(answer?.templates.map((info) => registeredTemplate(info, answer)) ?? [])];
    });
    createEffect(on(() => props.open, (open) => {
        if (!open) return;
        setChosen(EMPTY);
        setBusy(false);
    }));

    const submit = async () => {
        if (busy()) return;
        setBusy(true);
        try {
            const id = chosen();
            if (id === EMPTY) await props.onCreate({});
            else {
                const template = templates().find((t) => t.key === id);
                if (!template) throw new Error("That template isn't offered anymore");
                const made = template.build();
                if ("unavailable" in made) throw new Error(made.unavailable);
                await props.onCreate({ name: template.name, flows: made.flows });
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
                    <Index each={templates()}>
                        {(template) => {
                            // built once per answer of the registry, not once per read of it
                            const why = createMemo(() => {
                                const made = template().build();
                                return "unavailable" in made ? made.unavailable : null;
                            });
                            return (
                                <PaperSelectorItem value={template().key} icon={template().icon} description={why() ?? template().description} disabled={why() !== null}>
                                    {template().name}
                                </PaperSelectorItem>
                            );
                        }}
                    </Index>
                </PaperSelector>
                <Show when={registry.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't look for panels' templates"
                            error={err()}
                            action={{ label: "Try again", disabled: registry.loading(), onClick: () => void registry.reload() }}
                        />
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
