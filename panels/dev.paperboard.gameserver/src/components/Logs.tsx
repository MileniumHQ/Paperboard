import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperConsole,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    createLatest,
    createRead,
} from "@mileniumhq/paperui";
import { useServer } from "../lib/server";
import type { ServerCalls } from "../lib/api";
import { logLabel } from "../core/logs";
import { errorMessage, type Outcome } from "../lib/failure";

// Historical server logs: pick an archive (or latest.log), filter, read.
// Logs rotate on server start, so the list can change under us — a manual
// refresh is genuinely useful here rather than surprising.
export default function Logs() {
    const { calls } = useServer();
    const [files, setFiles] = createSignal<Awaited<ReturnType<ServerCalls["listLogFiles"]>> | null>(null);
    // a menu entry is a log's name, so a refresh (which rotates the list and
    // grows latest.log) keeps every entry whose log is still there
    const names = () => (files() ?? []).map((file) => file.name);
    const modifiedAt = (name: string) => files()!.find((file) => file.name === name)!.mtimeMs;
    const [selected, setSelected] = createSignal("");
    // the log picked is read, the newest pick the one shown; a log that
    // can't be read shows nothing of the one before it. Nothing is read
    // until the list has named one.
    const log = createRead((name) => calls.readLogFile({ name }), { source: () => selected() || null, message: errorMessage });
    const loading = log.loading;
    const content = () => (log.error() === null ? (log.value() ?? null) : null);
    const [listError, setError] = createSignal<Outcome | null>(null);
    const error = (): Outcome | null => {
        const read = log.loading() ? null : log.error();
        return listError() ?? (read === null ? null : { title: "Couldn't read this log", message: read });
    };
    const [filter, setFilter] = createSignal("");

    // the newest listing and the newest read are the ones shown: an older
    // one that finishes after them is dropped
    const latestList = createLatest();
    const loadFiles = async (selectName?: string) => {
        setError(null);
        const current = latestList();
        try {
            const list = await calls.listLogFiles();
            if (!current()) return;
            setFiles(list);
            const wanted =
                selectName && list.some((f) => f.name === selectName)
                    ? selectName
                    : list[0]?.name;
            if (wanted) await selectFile(wanted);
            else log.set(undefined);
        } catch (err) {
            if (!current()) return;
            setError({ title: "Couldn't list the logs", message: errorMessage(err) });
        }
    };

    /** shows the log `name`, read again when it is the one shown */
    const selectFile = (name: string) => {
        setError(null);
        if (name === selected()) return log.reload();
        setSelected(name);
        return log.ready();
    };

    onMount(() => {
        void loadFiles();
    });

    const filteredLines = () => {
        const body = content()?.content;
        if (body === undefined) return [];
        const lines = body.split(/\r?\n/);
        const query = filter().toLowerCase().trim();
        return query
            ? lines.filter((line) => line.toLowerCase().includes(query))
            : lines;
    };

    return (
        <>
            <PaperPageHeader icon="description" title="Logs">
                <PaperButton
                    disabled={loading()}
                    onClick={() => void loadFiles(selected())}>
                    <PaperIcon>refresh</PaperIcon>
                    Refresh
                </PaperButton>
            </PaperPageHeader>

            <Show when={error()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="warning" title={failure().title}>
                        {failure().message}
                    </PaperQuote>
                )}
            </Show>

            <PaperCard padding="full">
                <PaperFlex direction="row" gap="half" align="center" wrap>
                    <PaperFlex grow minWidth="card-min">
                        <PaperSelectMenu
                            name="logFile"
                            fullWidth
                            value={selected()}
                            onValueChange={(val) => void selectFile(String(val))}
                        >
                            <For each={names()}>
                                {(name) => (
                                    <PaperSelectMenuItem value={name}>
                                        {logLabel(name, modifiedAt(name))}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                    </PaperFlex>
                    <PaperFlex grow={2} minWidth="card-min">
                        <PaperInput
                            fullWidth
                            icon="search"
                            placeholder="Text"
                            value={filter()}
                            onInput={(e) => setFilter(e.currentTarget.value)}
                        />
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperCard grow minHeight={0} padding="full">
                <Show
                    when={content()}
                    fallback={
                        <PaperEmptyState
                            icon="description"
                            title={
                                files() === null
                                    ? "Loading logs..."
                                    : files()!.length === 0
                                      ? "No log files yet."
                                      : "Select a log file."
                            }
                        />
                    }
                >
                    <PaperConsole
                        showInput={false}
                        text={filteredLines().join("\n")}
                    />
                </Show>
            </PaperCard>
        </>
    );
}
