// Renaming and deleting a project, the same from the home screen and the
// editor. Each says what failed, in place, instead of closing on an error.
import { createEffect, createSignal, on, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperInput, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { MAX_PROJECT_NAME } from "../lib/projects";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The project's name in the editor's top bar, renamed in place: Enter or
 * leaving the field saves it, Escape puts it back. A name the service
 * refuses goes back too, and the reason goes to `onFailed`. */
export function ProjectNameField(props: {
    name: string;
    onRename: (name: string) => Promise<unknown>;
    onFailed: (reason: string) => void;
}) {
    const [draft, setDraft] = createSignal(props.name);
    const [editing, setEditing] = createSignal(false);
    // a name announced while nobody is typing is the one to show
    createEffect(on(() => props.name, (name) => {
        if (!editing()) setDraft(name);
    }));
    const commit = async () => {
        if (!editing()) return;
        const name = draft().trim();
        setEditing(false);
        if (!name || name === props.name) {
            setDraft(props.name);
            return;
        }
        try {
            await props.onRename(name);
        } catch (err) {
            setDraft(props.name);
            props.onFailed(message(err));
        }
    };
    return (
        <PaperInput
            compact
            aria-label="Project name"
            title="Rename"
            maxLength={MAX_PROJECT_NAME}
            value={draft()}
            onFocus={() => setEditing(true)}
            onInput={(e) => {
                setEditing(true);
                setDraft(e.currentTarget.value);
            }}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    void commit();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(props.name);
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

export function RenameProjectModal(props: {
    /** the project being renamed; closed when null */
    project: { id: string; name: string } | null;
    onRename: (id: string, name: string) => Promise<unknown>;
    onClose: () => void;
}) {
    const [name, setName] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(() => {
        const project = props.project;
        if (!project) return;
        setName(project.name);
        setError(null);
        setBusy(false);
    });
    const submit = async () => {
        const project = props.project;
        if (!project || busy()) return;
        setBusy(true);
        setError(null);
        try {
            await props.onRename(project.id, name());
            props.onClose();
        } catch (err) {
            setError(message(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.project)}
            onClose={props.onClose}
            title="Rename project"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="primary" disabled={busy() || !name().trim()} onClick={() => void submit()}>Rename</PaperButton>
                </PaperFlex>
            }
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <PaperFlex direction="column" gap="half">
                    <PaperInput
                        fullWidth
                        autofocus
                        label="Project name"
                        maxLength={MAX_PROJECT_NAME}
                        value={name()}
                        onInput={(e) => setName(e.currentTarget.value)}
                    />
                    <Show when={error()}>
                        {(text) => <PaperQuote variant="danger" icon="error" title="Not renamed" role="alert">{text()}</PaperQuote>}
                    </Show>
                </PaperFlex>
            </form>
        </PaperModal>
    );
}

export function DeleteProjectModal(props: {
    project: { id: string; name: string; flowCount: number } | null;
    onDelete: (id: string) => Promise<unknown>;
    onClose: () => void;
}) {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(() => {
        if (!props.project) return;
        setError(null);
        setBusy(false);
    });
    const confirm = async () => {
        const project = props.project;
        if (!project || busy()) return;
        setBusy(true);
        setError(null);
        try {
            await props.onDelete(project.id);
            props.onClose();
        } catch (err) {
            setError(message(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.project)}
            onClose={props.onClose}
            title="Delete project?"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="danger" disabled={busy()} onClick={() => void confirm()}>Delete</PaperButton>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="body">
                    "{props.project?.name}" and its {props.project?.flowCount === 1 ? "flow" : `${props.project?.flowCount ?? 0} flows`} will be deleted.
                    This can't be undone; a backup made before now still has it.
                </PaperText>
                <Show when={error()}>
                    {(text) => <PaperQuote variant="danger" icon="error" title="Not deleted" role="alert">{text()}</PaperQuote>}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
