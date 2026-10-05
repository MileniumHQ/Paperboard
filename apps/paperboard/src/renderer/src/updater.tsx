import "@mileniumhq/paperui/style.css";
import "./shell.css";
import { render } from "solid-js/web";
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import {
    PaperProvider,
    PaperCard,
    PaperFlex,
    PaperText,
    PaperProgress,
    PaperButton, getVarCss } from "@mileniumhq/paperui";

function PaperUpdater() {
    const [progress, setProgress] = createSignal<number | null>(null);
    const [label, setLabel] = createSignal("Checking for updates…");
    const [failed, setFailed] = createSignal(false);
    const pendingFinishes: ReturnType<typeof setTimeout>[] = [];
    let finished = false;

    // Single fire-and-forget exit path shared by progress completion and the skip button
    const finish = () => {
        if (finished) return;
        finished = true;
        window.electron?.ipcRenderer?.send("updater-finish");
    };

    onMount(() => {
        // @ts-ignore
        const ipc = window.electron?.ipcRenderer;
        if (!ipc) {
            // Dev fallback
            setTimeout(finish, 1500);
            return;
        }

        const handler = (
            _: any,
            data: { progress: number | null; label: string; failed?: boolean },
        ) => {
            setProgress(data.progress);
            setLabel(data.label);
            // Registry and task failures stay visible until Skip. App
            // update failures are retained separately for the Home modal,
            // including failures that occur after this window closes.
            if (data.failed) {
                setFailed(true);
                setProgress(null);
                return;
            }

            if (data.progress === 100) {
                // Small pause so "Done!" is visible before the window closes
                const t = setTimeout(finish, 800);
                pendingFinishes.push(t);
            }
        };

        ipc.on("updater-progress", handler);
        onCleanup(() => {
            ipc.removeListener?.("updater-progress", handler);
            for (const t of pendingFinishes) clearTimeout(t);
        });
    });

    return (
        <PaperProvider
            fullHeight
            fullWidth
            style={{ background: "transparent" }}
        >
            <PaperCard
                surface="frontest"
                style={{
                    width: "100vw",
                    height: "100vh",
                    "box-sizing": "border-box",
                    "border-radius": `calc(${getVarCss("border-radius")} * 2)`,
                }}
            >
                <PaperFlex
                    gap="full"
                    padding="double"
                    fullWidth
                    fullHeight
                    center
                >
                    <PaperText weight={700} size={4}>
                        {label()}
                    </PaperText>
                    <Show when={!failed()}>
                        <PaperProgress value={progress() ?? undefined} max={100} />
                    </Show>
                    <PaperButton variant="text" onClick={finish}>
                        Skip
                    </PaperButton>
                </PaperFlex>
            </PaperCard>
        </PaperProvider>
    );
}

render(() => <PaperUpdater />, document.getElementById("root") as HTMLElement);
