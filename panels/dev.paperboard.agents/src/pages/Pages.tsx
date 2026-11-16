// Every page the agent made, newest first: open one beside the chat, or
// delete it after saying so. The list follows the service's pages revision,
// so a page the agent makes or deletes shows up live.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperModal, PaperQuote, PaperText, type ActionFailure, createAction } from "@mileniumhq/paperui";
import type { PageInfo } from "../contract";
import type { Launcher } from "./launcher";
import Picture from "./Picture";

export default function Pages(props: { pages: Launcher; name: string; onOpened: () => void }) {
    const { busy, error: openError, run } = createAction();
    const [deleteError, setDeleteError] = createSignal<ActionFailure | null>(null);
    const [deleting, setDeleting] = createSignal<PageInfo | null>(null);
    // one being opened is marked until it's open (then it's the one shown) or wasn't
    const [chosen, setChosen] = createSignal<string | null>(null);

    const open = async (name: string) => {
        setChosen(name);
        if (await run("Page not opened", () => props.pages.open(name))) props.onOpened();
        setChosen(null);
    };

    const askDelete = (a: PageInfo) => {
        setDeleteError(null);
        setDeleting(a);
    };

    const remove = () =>
        run(
            "Page not deleted",
            async () => {
                await props.pages.remove(deleting()!.name);
                setDeleting(null);
            },
            setDeleteError,
        );

    return (
        <>
            <Switch>
                <Match when={props.pages.list() === null && props.pages.listError()}>
                    {(why) => (
                        <PaperFlex padding="double">
                            <PaperEmptyState icon="error" title="The pages can't be read" description={why()}>
                                <PaperButton onClick={() => props.pages.reload()}>Try again</PaperButton>
                            </PaperEmptyState>
                        </PaperFlex>
                    )}
                </Match>
                <Match when={props.pages.list() === null}>
                    <PaperFlex padding="double">
                        <PaperLoader loaderStatus="indeterminate" label="Reading the pages" />
                    </PaperFlex>
                </Match>
                <Match when={props.pages.list()!.length === 0}>
                    <PaperFlex padding="double">
                        <PaperEmptyState icon="web" title="No pages yet" description={`Ask ${props.name} for one, like a planner for your assignments or a birthday card, and it shows up here.`} />
                    </PaperFlex>
                </Match>
                <Match when={true}>
                    <PaperFlex flex minHeight={0}>
                        {/* a read again that failed leaves the list as it was last read: it says so */}
                        <Show when={props.pages.listError()}>
                            {(why) => (
                                <PaperFlex padding="full" gap="half">
                                    <PaperQuote variant="danger" icon="error" title="The list may be out of date" role="alert">
                                        {why()}
                                    </PaperQuote>
                                    <PaperFlex direction="row">
                                        <PaperButton onClick={() => props.pages.reload()}>
                                            <PaperIcon>refresh</PaperIcon> Try again
                                        </PaperButton>
                                    </PaperFlex>
                                </PaperFlex>
                            )}
                        </Show>
                        <Show when={openError()}>
                            {(shown) => (
                                <PaperFlex padding="full">
                                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                        {shown().message}
                                    </PaperQuote>
                                </PaperFlex>
                            )}
                        </Show>
                        {/* the page open beside the chat is marked */}
                        <PaperList
                            name="agents-pages"
                            value={chosen() ?? props.pages.shown()?.name ?? ""}
                            onValueChange={(v) => void open(String(v))}
                            borderless
                            fullWidth
                            fullHeight
                        >
                            <For each={props.pages.list()}>
                                {(a) => (
                                    <PaperListItem
                                        value={a.name}
                                        disabled={busy()}
                                        icon={<Picture pages={props.pages} name={a.name} title={a.title} />}
                                        description={a.description || `~/Pages/${a.name}`}
                                        actions={
                                            <PaperFlex direction="row" align="center" gap="onefourth">
                                                <PaperButton size="small" variant="text" disabled={busy()} onClick={() => void open(a.name)}>
                                                    Open <PaperIcon>open_in_new</PaperIcon>
                                                </PaperButton>
                                                <PaperButton icon size="small" variant="text" disabled={busy()} aria-label={`Delete “${a.title}”`} title="Delete" onClick={() => askDelete(a)}>
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
                title="Delete this page?"
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
                    <PaperText preset="text">
                        “{deleting()?.title}” and its folder, ~/Pages/{deleting()?.name}, are deleted. A checkpoint from before now still has it.
                    </PaperText>
                    <Show when={deleteError()}>
                        {(shown) => (
                            <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                {shown().message}
                            </PaperQuote>
                        )}
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
