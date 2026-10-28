// Every app the agent made, newest first: open one beside the chat, or
// delete it after saying so. The list follows the service's apps revision,
// so an app the agent makes or deletes shows up live.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { AppInfo } from "../contract";
import { errorText, failure, type Failure } from "../lib/failure";
import type { Launcher } from "./launcher";
import Picture from "./Picture";

// a button inside a list item answers for itself, and doesn't choose the item
const own = (e: PointerEvent) => e.stopPropagation();

export default function Apps(props: { apps: Launcher; name: string; onOpened: () => void }) {
    const { apps } = props;
    const [openError, setOpenError] = createSignal<Failure | null>(null);
    const [deleteError, setDeleteError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [deleting, setDeleting] = createSignal<AppInfo | null>(null);

    const open = async (name: string) => {
        setBusy(true);
        setOpenError(null);
        try {
            await apps.open(name);
            props.onOpened();
        } catch (e) {
            setOpenError(failure("App not opened", e));
        } finally {
            setBusy(false);
        }
    };

    const askDelete = (a: AppInfo) => {
        setDeleteError(null);
        setDeleting(a);
    };

    const remove = async () => {
        setBusy(true);
        setDeleteError(null);
        try {
            await apps.remove(deleting()!.name);
            setDeleting(null);
        } catch (e) {
            setDeleteError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Switch>
                <Match when={apps.list() === null && apps.listError()}>
                    {(why) => (
                        <PaperEmptyState icon="error" title="The apps can't be read" description={why()}>
                            <PaperButton onClick={() => apps.reload()}>Try again</PaperButton>
                        </PaperEmptyState>
                    )}
                </Match>
                <Match when={apps.list() === null}>
                    <PaperLoader loaderStatus="indeterminate" label="Reading the apps" />
                </Match>
                <Match when={apps.list()!.length === 0}>
                    <PaperEmptyState icon="apps" title="No apps yet" description={`Ask ${props.name} for one, like a planner for your assignments, and it shows up here.`} />
                </Match>
                <Match when={true}>
                    <PaperFlex gap="half">
                        <Show when={openError()}>
                            {(shown) => (
                                <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                    {shown().message}
                                </PaperQuote>
                            )}
                        </Show>
                        <PaperList name="agents-apps" value={apps.shown()?.name ?? ""} onValueChange={(v) => void open(String(v))}>
                            <For each={apps.list()}>
                                {(a) => (
                                    <PaperListItem
                                        value={a.name}
                                        disabled={busy()}
                                        icon={<Picture apps={apps} name={a.name} title={a.title} taken={a.picture} />}
                                        description={a.description || `~/Apps/${a.name}`}
                                        actions={
                                            <PaperFlex direction="row" align="center" gap="onefourth">
                                                <PaperButton size="small" variant="text" disabled={busy()} onPointerDown={own} onClick={() => void open(a.name)}>
                                                    Open <PaperIcon>open_in_new</PaperIcon>
                                                </PaperButton>
                                                <PaperButton icon size="small" variant="text" disabled={busy()} aria-label={`Delete “${a.title}”`} title="Delete" onPointerDown={own} onClick={() => askDelete(a)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </PaperFlex>
                                        }
                                    >
                                        {a.title}
                                    </PaperListItem>
                                )}
                            </For>
                        </PaperList>
                    </PaperFlex>
                </Match>
            </Switch>
            <PaperModal
                open={deleting() !== null}
                onClose={() => !busy() && setDeleting(null)}
                title="Delete this app?"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy()} onClick={() => setDeleting(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton variant="danger" disabled={busy()} onClick={() => void remove()}>
                            Delete
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex gap="full">
                    <PaperText>
                        “{deleting()?.title}” and its folder, ~/Apps/{deleting()?.name}, are deleted. A checkpoint from before now still has it.
                    </PaperText>
                    <Show when={deleteError()}>
                        <PaperQuote variant="danger" icon="error" title="App not deleted" role="alert">
                            {deleteError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
