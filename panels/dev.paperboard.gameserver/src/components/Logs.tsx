import { batch, createSignal, For, onMount, Show } from "solid-js";
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
} from "@mileniumhq/paperui";
import {
    listLogFiles,
    readLogFile,
    type LogFileContent,
    type LogFileInfo,
} from "../lib/logFiles";
import { logLabel } from "../core/logs";
import { errorMessage, type Outcome } from "../lib/failure";

// Historical server logs: pick an archive (or latest.log), filter, read.
// Logs rotate on server start, so the list can change under us — a manual
// refresh is genuinely useful here rather than surprising.
export default function Logs() {
    const [files, setFiles] = createSignal<LogFileInfo[] | null>(null);
    // a menu entry is a log's name, so a refresh (which rotates the list and
    // grows latest.log) keeps every entry whose log is still there
    const names = () => (files() ?? []).map((file) => file.name);
    const modifiedAt = (name: string) => files()!.find((file) => file.name === name)!.mtimeMs;
    const [selected, setSelected] = createSignal("");
    const [content, setContent] = createSignal<LogFileContent | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<Outcome | null>(null);
    const [filter, setFilter] = createSignal("");

    // the newest listing and the newest read are the ones shown: an older
    // one that finishes after them is dropped
    const latestList = createLatest();
    const loadFiles = async (selectName?: string) => {
        setError(null);
        const current = latestList();
        try {
            const list = await listLogFiles();
            if (!current()) return;
            setFiles(list);
            const wanted =
                selectName && list.some((f) => f.name === selectName)
                    ? selectName
                    : list[0]?.name;
            if (wanted) await selectFile(wanted);
            else setContent(null);
        } catch (err) {
            if (!current()) return;
            console.error("[Logs] Failed to list log files:", err);
            setError({ title: "Couldn't list the logs", message: errorMessage(err) });
        }
    };

    const latest = createLatest();
    const selectFile = async (name: string) => {
        setSelected(name);
        setLoading(true);
        setError(null);
        const current = latest();
        try {
            const answer = await readLogFile(name);
            if (!current()) return;
            batch(() => {
                setContent(answer);
                setLoading(false);
            });
        } catch (err) {
            if (!current()) return;
            const message = errorMessage(err);
            console.error(`[Logs] Failed to read "${name}":`, message);
            batch(() => {
                setContent(null);
                setError({ title: "Couldn't read this log", message });
                setLoading(false);
            });
        }
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
                            placeholder="Filter lines..."
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
