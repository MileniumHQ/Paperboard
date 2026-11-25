// Picks a folder on the computer Paperboard runs on and links it into Drive.
// The folders come from the service, so this works from a phone or another
// computer as well as on this one. It opens in the home folder.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperList,
    PaperListItem,
    PaperLoader,
    PaperModal,
    PaperText,
    showError,
} from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import { drive } from "./client";
import type { HostFolder, Place } from "./lib/contract";

export interface LinkFolderProps {
    open: boolean;
    onClose: () => void;
    onLinked: (place: Place) => void;
}

export default function LinkFolder(props: LinkFolderProps) {
    const [at, setAt] = createSignal<HostFolder | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    let token = 0;

    async function go(folder: string) {
        const mine = ++token;
        setError(null);
        try {
            const listed = await drive.calls.browse({ folder });
            if (mine === token) setAt(listed);
        } catch (err) {
            if (mine === token) setError(errorMessage(err));
        }
    }

    // each time it opens, it starts at home
    createEffect(
        on(
            () => props.open,
            (open) => {
                if (!open) return;
                setAt(null);
                void go("");
            },
        ),
    );

    async function link() {
        const folder = at();
        if (!folder) return;
        setBusy(true);
        try {
            props.onLinked(await drive.calls.link({ folder: folder.path }));
        } catch (err) {
            showError(`Couldn't link “${folder.name}”`, err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="Link a folder"
            footer={
                <>
                    <PaperButton variant="text" onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="primary" disabled={!at() || busy()} onClick={() => void link()}>
                        {at() ? `Link “${at()!.name}”` : "Link"}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="full">
                <PaperText preset="body" color="text-muted">
                    Its files show in Drive where they are. Nothing is copied or moved.
                </PaperText>
                <PaperFlex direction="row" align="center" gap="half">
                    <PaperButton icon variant="text" size="small" aria-label="Enclosing folder" title="Enclosing folder" disabled={!at()?.parent} onClick={() => at()?.parent && void go(at()!.parent!)}>
                        chevron_left
                    </PaperButton>
                    <PaperFlex flex minWidth={0}>
                        <PaperText preset="label" truncate>
                            {at()?.path ?? ""}
                        </PaperText>
                    </PaperFlex>
                </PaperFlex>
                <Show
                    when={!error()}
                    fallback={
                        <PaperEmptyState icon="error" title="This folder can't be opened" description={error()!}>
                            <PaperButton onClick={() => void go("")}>
                                <PaperIcon zeroHeight>home</PaperIcon>
                                Home folder
                            </PaperButton>
                        </PaperEmptyState>
                    }
                >
                    <Show when={at()} fallback={<PaperLoader loaderStatus="indeterminate" label="Opening" />}>
                        {(folder) => (
                            <Show when={folder().folders.length > 0} fallback={<PaperEmptyState icon="folder_open" title="No folders in here" description="You can still link this one." />}>
                                <PaperList standalone selectable={false} buttons scrollable="y" aria-label={`Folders in ${folder().name}`}>
                                    <For each={folder().folders}>
                                        {(sub) => (
                                            <PaperListItem value={sub.path} icon="folder" onClick={() => void go(sub.path)}>
                                                {sub.name}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>
                            </Show>
                        )}
                    </Show>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
