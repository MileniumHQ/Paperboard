import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperConsole,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    getVarCss,
} from "@paperboard-dev/paperui";
import {
    listLogFiles,
    readLogFile,
    type LogFileContent,
    type LogFileInfo,
} from "../lib/logFiles";
import { logLabel } from "../core/logs";

// Historical server logs: pick an archive (or latest.log), filter, read.
// Logs rotate on server start, so the list can change under us — a manual
// refresh is genuinely useful here rather than surprising.
export default function Logs() {
    const [files, setFiles] = createSignal<LogFileInfo[] | null>(null);
    const [selected, setSelected] = createSignal("");
    const [content, setContent] = createSignal<LogFileContent | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    const [filter, setFilter] = createSignal("");

    const loadFiles = async (selectName?: string) => {
        setError("");
        try {
            const list = await listLogFiles();
            setFiles(list);
            const wanted =
                selectName && list.some((f) => f.name === selectName)
                    ? selectName
                    : list[0]?.name;
            if (wanted) await selectFile(wanted);
            else setContent(null);
        } catch (err) {
            console.error("[Logs] Failed to list log files:", err);
            setError("Could not list log files. Check the console for details.");
        }
    };

    const selectFile = async (name: string) => {
        setSelected(name);
        setLoading(true);
        setError("");
        try {
            setContent(await readLogFile(name));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Logs] Failed to read "${name}":`, message);
            setContent(null);
            setError(message);
        } finally {
            setLoading(false);
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
        <PaperPage fullWidth fullHeight gap="full">
            <PaperPageHeader icon="description" title="Logs">
                <PaperButton
                    disabled={loading()}
                    onClick={() => void loadFiles(selected())}>
                    <PaperIcon>refresh</PaperIcon>
                    Refresh
                </PaperButton>
            </PaperPageHeader>

            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Error">
                    {error()}
                </PaperQuote>
            </Show>

            <PaperCard padding="full">
                <PaperFlex direction="row" gap="half" align="center" wrap>
                    <PaperFlex grow minWidth={getVarCss("size-card-min")}>
                        <PaperSelectMenu
                            name="logFile"
                            fullWidth
                            value={selected()}
                            onValueChange={(val) => void selectFile(String(val))}
                        >
                            <For each={files() ?? []}>
                                {(file) => (
                                    <PaperSelectMenuItem value={file.name}>
                                        {logLabel(file.name, file.mtimeMs)}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                    </PaperFlex>
                    <PaperFlex grow={2} minWidth={getVarCss("size-card-min")}>
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

            <PaperCard grow minHeight={0}>
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
        </PaperPage>
    );
}
