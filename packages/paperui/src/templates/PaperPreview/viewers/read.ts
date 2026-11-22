import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { PAPER_PREVIEW_TEXT_BYTES } from "../kinds";
import { errorMessage } from "../../../utils/errorMessage";

export interface ReadText {
    text: string;
    /** the file was longer than the cap and only its start was read */
    cut: boolean;
}

/**
 * Reads at most `cap` bytes of a file and stops the download there, so a
 * huge log or table costs only what is shown. The cut never splits a
 * character: a multi-byte one straddling the cap is dropped.
 */
export async function readTextStart(src: string, signal: AbortSignal, cap = PAPER_PREVIEW_TEXT_BYTES): Promise<ReadText> {
    const response = await fetch(src, { signal });
    if (!response.ok) throw new Error(`couldn't be read (${response.status})`);
    if (!response.body) {
        const blob = await response.blob();
        return { text: await blob.slice(0, cap).text(), cut: blob.size > cap };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let cut = false;
    while (total < cap) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
    }
    if (total >= cap) {
        // anything past the cap is more than we show, whether or not the stream had more
        const { done } = total > cap ? { done: false } : await reader.read();
        cut = !done;
        await reader.cancel();
    }
    const bytes = new Uint8Array(Math.min(total, cap));
    let at = 0;
    for (const chunk of chunks) {
        const take = Math.min(chunk.byteLength, bytes.byteLength - at);
        bytes.set(chunk.subarray(0, take), at);
        at += take;
        if (at >= bytes.byteLength) break;
    }
    // stream: true keeps an incomplete last character out instead of a replacement mark
    return { text: new TextDecoder("utf-8").decode(bytes, { stream: cut }), cut };
}

/**
 * The start of the file at `src()` as text, read again whenever `src`
 * changes; a read a newer one replaces is aborted and its answer dropped.
 */
export function createTextRead(src: () => string, onError: (message: string) => void) {
    const [value, setValue] = createSignal<ReadText | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(
        on(src, (url) => {
            const controller = new AbortController();
            setValue(null);
            setError(null);
            readTextStart(url, controller.signal).then(
                (read) => {
                    if (!controller.signal.aborted) setValue(read);
                },
                (err: unknown) => {
                    if (controller.signal.aborted) return;
                    const message = errorMessage(err);
                    setError(message);
                    onError(message);
                },
            );
            onCleanup(() => controller.abort());
        }),
    );
    return { value, error };
}
