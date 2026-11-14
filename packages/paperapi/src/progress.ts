import { on } from "./ipc";

/**
 * Hands each update of a download's progress stream to `onProgress` and
 * stops listening once it completes or fails. The caller tears it down
 * itself when the download is refused before it starts, so a listener is
 * never left subscribed for a download that never runs.
 */
export function followProgress<P extends { stage: string }>(channel: string, onProgress: (progress: P) => void): () => void {
    const off = on(channel, (_event: unknown, progress: P | undefined) => {
        if (!progress) return;
        onProgress(progress);
        if (progress.stage === "completed" || progress.stage === "error") off();
    });
    return off;
}
