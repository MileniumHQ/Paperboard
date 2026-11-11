import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Component } from "solid-js";
import { PaperButton, PaperList, PaperListItem, PaperListLabel, PaperLoader, PaperPopover, showToast } from "@mileniumhq/paperui";
import {
    batchPercent,
    groupHolds,
    holdGroupReason,
    holdGroupTitle,
    listOf,
    pendingUpdates,
    type UpdateHoldGroup,
    type UpdateItem,
    type UpdateQueueState,
} from "../../../../shared/updateQueue";
import { updateWhere } from "../../hooks/useUpdateQueue";

// how long the finished check (or cross) stays before the button goes
const FINISH_MS = 1800;

function megabytes(bytes: number): string {
    const mb = bytes / 1048576;
    return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** what the list says under an item's name */
export function itemDetail(item: UpdateItem): string {
    switch (item.status) {
        case "queued":
            return "Waiting";
        case "done":
            return item.version ? `Updated to ${item.version}` : "Updated";
        case "held":
            return "Waiting for what is using it";
        case "failed":
            return item.error ?? "Couldn't update";
    }
    if (item.stage === "stopping") return "Stopping processes";
    if (item.stage === "installing") return "Installing";
    if (item.bytesLoaded !== null && item.bytesTotal) return `Downloading ${megabytes(item.bytesLoaded)} of ${megabytes(item.bytesTotal)}`;
    if (item.percent !== null) return `Downloading ${item.percent}%`;
    return "Downloading";
}

function itemLoader(item: UpdateItem) {
    if (item.status === "done") return "success" as const;
    if (item.status === "failed") return "error" as const;
    if (item.status === "queued" || item.status === "held") return "waiting" as const;
    return item.percent === null ? ("indeterminate" as const) : ("loading" as const);
}

function HoldRow(props: { group: UpdateHoldGroup; onRelease: (keys: string[]) => Promise<void> }) {
    const [busy, setBusy] = createSignal(false);
    const release = async () => {
        setBusy(true);
        try {
            await props.onRelease(props.group.keys);
        } catch (err) {
            showToast({
                variant: "danger",
                title: `${listOf(props.group.names)} couldn't update`,
                message: err instanceof Error ? err.message : String(err),
            });
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperListItem
            value={props.group.keys.join("\u0000")}
            loaderStatus="waiting"
            description={holdGroupReason(props.group)}
            actions={
                <PaperButton size="small" disabled={busy()} onClick={() => void release()}>
                    Stop and update
                </PaperButton>
            }
        >
            {holdGroupTitle(props.group)}
        </PaperListItem>
    );
}

/**
 * The top bar's update button: a small loader counting the updates left.
 * It opens a popover listing them; a finished batch shows its check, then
 * the button goes, unless updates are held back by what is using them.
 */
const UpdatesButton: Component<{
    state: UpdateQueueState;
    onRelease: (keys: string[]) => Promise<void>;
}> = (props) => {
    let button: HTMLButtonElement | undefined;
    const [open, setOpen] = createSignal(false);
    // the batch just finished: its check (or cross) shows for a moment
    const [finished, setFinished] = createSignal<"success" | "error" | null>(null);
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(finishTimer));

    const pending = () => pendingUpdates(props.state).length;
    const groups = createMemo(() => groupHolds(props.state.holds));
    // a held item is said by its group, with its button
    const items = createMemo(() => props.state.items.filter((item) => item.status !== "held"));
    // every update of the queue is a new copy of it: rows follow their key,
    // not the copy, so a row (its loader, a busy button) lives as long as
    // its update is listed instead of being made again on every tick
    const itemByKey = createMemo(() => new Map(items().map((item) => [item.key, item])));
    const groupByKey = createMemo(() => new Map(groups().map((group) => [group.keys.join("\u0000"), group])));
    const visible = () => pending() > 0 || finished() !== null || groups().length > 0;

    createEffect(on(pending, (now, before) => {
        if (now > 0) {
            clearTimeout(finishTimer);
            setFinished(null);
            return;
        }
        if (!before) return;
        const failed = props.state.items.some((item) => item.status === "failed");
        setFinished(failed ? "error" : "success");
        clearTimeout(finishTimer);
        finishTimer = setTimeout(() => {
            setFinished(null);
            // with nothing held, an open list has nothing left to say
            if (groups().length === 0) setOpen(false);
        }, FINISH_MS);
    }));

    // a batch that ends with updates held back says so without being asked
    createEffect(on(
        () => (pending() === 0 ? props.state.holds.map((h) => h.key).join("\u0000") : ""),
        (keys, before) => {
            if (keys && keys !== before) setOpen(true);
        },
    ));

    const loaderStatus = () => {
        const done = finished();
        if (done) return done;
        if (pending() === 0) return "waiting" as const;
        return batchPercent(props.state) === null ? ("indeterminate" as const) : ("loading" as const);
    };
    const count = () => (finished() ? undefined : pending() > 0 ? pending() : groups().length);
    const label = () => {
        if (pending() > 0) return pending() === 1 ? "1 update left" : `${pending()} updates left`;
        if (finished()) return finished() === "error" ? "Some updates failed" : "Updates finished";
        return groups().length === 1 ? "1 update is waiting" : `${groups().length} updates are waiting`;
    };

    return (
        <Show when={visible()}>
            <PaperButton
                ref={button}
                size="tiny"
                icon
                variant="text"
                title={label()}
                aria-label={label()}
                aria-expanded={open()}
                onClick={() => setOpen(!open())}
            >
                <PaperLoader size="small" loaderStatus={loaderStatus()} percent={batchPercent(props.state) ?? 0}>
                    {count()}
                </PaperLoader>
            </PaperButton>
            <PaperPopover open={open()} anchor={button} onClose={() => setOpen(false)} title="Updates" flush>
                <PaperList selectable={false} borderless fullWidth scrollable={false}>
                    <For each={[...itemByKey().keys()]}>
                        {(key) => (
                            <Show when={itemByKey().get(key)}>
                                {(item) => (
                                    <PaperListItem
                                        value={key}
                                        loaderStatus={itemLoader(item())}
                                        percent={item().percent ?? 0}
                                        description={itemDetail(item())}
                                    >
                                        {item().name}
                                        {updateWhere(item())}
                                    </PaperListItem>
                                )}
                            </Show>
                        )}
                    </For>
                    <Show when={groups().length > 0}>
                        <PaperListLabel>Waiting</PaperListLabel>
                    </Show>
                    <For each={[...groupByKey().keys()]}>
                        {(key) => (
                            <Show when={groupByKey().get(key)}>
                                {(group) => <HoldRow group={group()} onRelease={props.onRelease} />}
                            </Show>
                        )}
                    </For>
                </PaperList>
            </PaperPopover>
        </Show>
    );
};

export default UpdatesButton;
