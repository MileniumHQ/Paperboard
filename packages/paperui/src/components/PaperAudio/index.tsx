import styles from "./index.module.css";
import {
    createEffect,
    createMemo,
    createSignal,
    createUniqueId,
    For,
    on,
    onCleanup,
    onMount,
    Show,
    splitProps,
    type JSX,
} from "solid-js";
import {
    createMediaPlayer,
    formatMediaTime,
    MediaActions,
    MediaError,
    MediaPlayButton,
    MediaSeek,
    MediaTime,
    PAPER_MEDIA_RATES,
} from "../shared/media";
import { DEFAULT_WAVEFORM_MAX_BYTES, loadWaveform } from "./waveform";

export { computePeaks, loadWaveform, WAVEFORM_RESOLUTION, DEFAULT_WAVEFORM_MAX_BYTES } from "./waveform";

/** Bars drawn before the track has been measured (and in layout-less environments). */
export const PAPER_AUDIO_FALLBACK_BARS = 64;

/**
 * Bars and the gaps between them are each `--paper-thick-border-width` wide,
 * so a wider track draws more bars. Returns how many fit and where they start.
 */
export function waveformLayout(trackWidth: number, bar: number) {
    const pitch = bar * 2;
    const count = trackWidth > 0 ? Math.max(8, Math.floor((trackWidth + bar) / pitch)) : PAPER_AUDIO_FALLBACK_BARS;
    const width = trackWidth > 0 ? trackWidth : count * pitch - bar;
    const offset = (width - (count * pitch - bar)) / 2;
    return { count, width, offset, pitch };
}

/**
 * Where the progress fill ends. Progress is spread over the bars only, never
 * the gaps: a linear fill spends half its time crossing gaps, where the bars
 * hide it, so playback looks like it stalls and then fills a bar at a time.
 * Here the edge always sits inside a bar, moving at a constant speed, and
 * steps over each gap instantly.
 */
export function waveformFillWidth(
    progress: number,
    layout: ReturnType<typeof waveformLayout>,
    bar: number,
): number {
    const p = Math.min(1, Math.max(0, progress));
    if (p >= 1) return layout.width;
    const along = p * layout.count * bar;
    const index = Math.floor(along / bar);
    return layout.offset + index * layout.pitch + (along - index * bar);
}

export const PAPER_AUDIO_RATES = PAPER_MEDIA_RATES;

export type PaperAudioWaveformState = "loading" | "ready" | "unavailable" | "off";

export interface PaperAudioProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    src: string;
    /** Accessible name for the player group. Defaults to "Audio". */
    label?: string;
    /**
     * Precomputed amplitudes from 0 to 1. When set, the player draws these
     * instead of fetching and decoding `src`.
     */
    peaks?: number[];
    /** Fetch and decode `src` to draw its waveform. Defaults to true. */
    waveform?: boolean;
    /** Largest source, in bytes, the player downloads to draw a waveform. */
    waveformMaxBytes?: number;
    /** Fill the container instead of the default width. */
    fullWidth?: boolean;
    preload?: "none" | "metadata" | "auto";
    /** Called with the message shown in the player when playback fails. */
    onError?: (message: string) => void;
}

/** "1:05", or "1:02:05" past an hour. */
export const formatAudioTime = formatMediaTime;

/** Resamples peaks to `count` bars by taking the peak of each bucket. */
export function resamplePeaks(peaks: readonly number[], count: number): number[] {
    if (count <= 0) return [];
    if (peaks.length === 0) return new Array(count).fill(0);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        const start = Math.floor((i * peaks.length) / count);
        const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
        let peak = 0;
        for (let j = start; j < end && j < peaks.length; j++) {
            const v = peaks[j];
            if (Number.isFinite(v) && v > peak) peak = v;
        }
        out.push(Math.min(1, peak));
    }
    return out;
}

export function PaperAudio(props: PaperAudioProps) {
    const [local, rest] = splitProps(props, [
        "src",
        "label",
        "peaks",
        "waveform",
        "waveformMaxBytes",
        "fullWidth",
        "preload",
        "onError",
        "class",
        "classList",
    ]);

    let track: HTMLDivElement | undefined;

    const player = createMediaPlayer({ noun: "audio", onError: (message) => local.onError?.(message) });
    // measured track box and the bar token in px; before measurement (or
    // without layout) the bar is 2, the token's shipped value
    const [trackBox, setTrackBox] = createSignal({ width: 0, height: 0, bar: 2 });
    const clipId = `paper-audio-wave-${createUniqueId()}`;
    const [decoded, setDecoded] = createSignal<number[] | null>(null);
    const [waveformState, setWaveformState] = createSignal<PaperAudioWaveformState>("loading");

    // Waveform: caller peaks win; otherwise decode the source, cancelling the
    // previous decode whenever the source changes or the player unmounts.
    createEffect(
        on(
            () => [local.src, local.peaks, local.waveform, local.waveformMaxBytes] as const,
            ([src, peaks, enabled, maxBytes]) => {
                setDecoded(null);
                if (peaks) {
                    setWaveformState("ready");
                    return;
                }
                if (enabled === false) {
                    setWaveformState("off");
                    return;
                }
                setWaveformState("loading");
                const controller = new AbortController();
                onCleanup(() => controller.abort());
                loadWaveform(src, controller.signal, maxBytes ?? DEFAULT_WAVEFORM_MAX_BYTES).then(
                    (result) => {
                        if (controller.signal.aborted) return;
                        setDecoded(result);
                        setWaveformState("ready");
                    },
                    () => {
                        // abort means a newer source or unmount took over
                        if (controller.signal.aborted) return;
                        setWaveformState("unavailable");
                    },
                );
            },
        ),
    );

    const layout = createMemo(() => waveformLayout(trackBox().width, trackBox().bar));
    const waveHeight = () => trackBox().height || 32;

    const bars = createMemo(() => {
        const count = layout().count;
        const source = local.peaks ?? decoded();
        if (source) return resamplePeaks(source, count);
        // unavailable/off: uniform bars; loading: a flat line until peaks land
        const flat = waveformState() === "loading" ? 0 : 0.5;
        return new Array<number>(count).fill(flat);
    });

    onMount(() => {
        if (!track || typeof ResizeObserver === "undefined") return;
        const measure = () => {
            if (!track) return;
            const token = parseFloat(
                getComputedStyle(track).getPropertyValue("--paper-thick-border-width"),
            );
            const r = track.getBoundingClientRect();
            if (r.width <= 0) return;
            setTrackBox({
                width: r.width,
                height: r.height,
                bar: Number.isFinite(token) && token > 0 ? token : trackBox().bar,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(track);
        onCleanup(() => observer.disconnect());
    });

    const className = () =>
        [
            styles.PaperAudio,
            local.fullWidth ? styles.fullWidth : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            role="group"
            aria-label={local.label ?? "Audio"}
            {...rest}
            class={className()}
            classList={local.classList}
        >
            <audio
                {...player.element}
                src={local.src}
                preload={local.preload ?? "metadata"}
                loop={player.loop()}
            />

            <MediaPlayButton player={player} />

            <div class={styles.track} ref={track} data-waveform={waveformState()}>
                <Show when={player.error() === null} fallback={<MediaError player={player} />}>
                    {/* The bars are a clip path; one fill rect slides underneath
                        them, advanced through bars only (waveformFillWidth) so
                        it never idles unseen in a gap. */}
                    <svg
                        class={styles.wave}
                        aria-hidden="true"
                        viewBox={`0 0 ${layout().width} ${waveHeight()}`}
                        preserveAspectRatio="none"
                    >
                        <defs>
                            <clipPath id={clipId}>
                                <For each={bars()}>
                                    {(amplitude, i) => {
                                        const height = () =>
                                            Math.max(trackBox().bar, amplitude * waveHeight() * 0.75);
                                        return (
                                            <rect
                                                x={layout().offset + i() * layout().pitch}
                                                y={(waveHeight() - height()) / 2}
                                                width={trackBox().bar}
                                                height={height()}
                                                rx={trackBox().bar / 2}
                                            />
                                        );
                                    }}
                                </For>
                            </clipPath>
                        </defs>
                        <g clip-path={`url(#${clipId})`}>
                            <rect class={styles.waveBase} width={layout().width} height={waveHeight()} />
                            <rect
                                class={styles.waveFill}
                                data-progress=""
                                width={waveformFillWidth(player.progress(), layout(), trackBox().bar)}
                                height={waveHeight()}
                            />
                        </g>
                    </svg>
                    <MediaSeek player={player} />
                </Show>
            </div>

            <MediaTime player={player} />

            <MediaActions player={player} label="Audio options" />
        </div>
    );
}
