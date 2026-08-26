import "@paperboard-dev/paperui/style.css";
import { render } from "solid-js/web";
import { createSignal, onMount, onCleanup } from "solid-js";
import {
    PaperProvider,
    PaperContainer,
    PaperFlex,
    PaperText,
    PaperProgress,
    PaperButton,
} from "@paperboard-dev/paperui";

function PaperUpdater() {
    const [progress, setProgress] = createSignal<number | null>(null);
    const [label, setLabel] = createSignal("Checking for updates…");
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
            data: { progress: number | null; label: string },
        ) => {
            setProgress(data.progress);
            setLabel(data.label);

            if (data.progress === 100) {
                // Small pause so "Done!" is visible before the window closes
                setTimeout(finish, 800);
            }
        };

        ipc.on("updater-progress", handler);
        onCleanup(() => ipc.removeListener?.("updater-progress", handler));
    });

    return (
        <PaperProvider
            fullHeight
            fullWidth
            style={{ background: "transparent" }}
        >
            <PaperContainer
                style={{
                    width: "100vw",
                    height: "100vh",
                    "box-sizing": "border-box",
                    "border-radius": "calc(var(--paper-border-radius) * 2)",
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
                    <PaperProgress value={progress() ?? undefined} max={100} />
                    <PaperButton variant="text" compact onClick={finish}>
                        Skip
                    </PaperButton>
                </PaperFlex>
            </PaperContainer>
        </PaperProvider>
    );
}

render(() => <PaperUpdater />, document.getElementById("root") as HTMLElement);
