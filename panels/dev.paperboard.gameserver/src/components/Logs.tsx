import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
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
    let viewer: HTMLPreElement | undefined;

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

    // logs read best from the most recent line, so a freshly loaded file
    // starts scrolled to the bottom
    createEffect(() => {
        content();
        queueMicrotask(() => {
            if (viewer) viewer.scrollTop = viewer.scrollHeight;
        });
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
        <PaperFlex direction="column" fullWidth fullHeight style={{ "min-height": 0 }}>
            <div class="gs-page">
                <PaperPageHeader icon="description" title="Logs">
                    <PaperButton
                        compact
                        disabled={loading()}
                        onClick={() => void loadFiles(selected())}
                    >
                        <PaperIcon>refresh</PaperIcon>
                        Refresh
                    </PaperButton>
                </PaperPageHeader>
                <Show when={error()}>
                    <PaperQuote variant="red" icon="warning" title="Error">
                        {error()}
                    </PaperQuote>
                </Show>
                <div class="gs-surface">
                    <PaperFlex
                        direction="row"
                        gap="half"
                        padding="full"
                        align="center"
                        wrap
                    >
                        <div style={{ "min-width": "16rem", flex: "1" }}>
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
                        </div>
                        <div style={{ "min-width": "14rem", flex: "2" }}>
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder="Filter lines..."
                                value={filter()}
                                onInput={(e) => setFilter(e.currentTarget.value)}
                            />
                        </div>
                    </PaperFlex>
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    "min-height": 0,
                    padding: "var(--paper-uigap)",
                    "padding-top": 0,
                }}
            >
                <div class="gs-surface" style={{ height: "100%" }}>
                    <Show
                        when={content()}
                        fallback={
                            <PaperFlex padding="full" center fullHeight>
                                <PaperText size={3} color="light-text">
                                    {files() === null
                                        ? "Loading logs..."
                                        : files()!.length === 0
                                          ? "No log files yet."
                                          : "Select a log file."}
                                </PaperText>
                            </PaperFlex>
                        }
                    >
                        <pre ref={viewer} class="log-view">{filteredLines().join("\n")}</pre>
                    </Show>
                </div>
            </div>
        </PaperFlex>
    );
}
