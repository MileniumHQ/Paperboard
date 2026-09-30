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
import { Portal } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperRange } from "../PaperRange";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuSub,
    useContextMenuState,
} from "../PaperContextMenu";
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

export const PAPER_AUDIO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;
const VOLUME_CLOSE_DELAY_MS = 150;

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

export function formatAudioTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = String(whole % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

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

function mediaErrorMessage(error: MediaError | null): string {
    switch (error?.code) {
        case 1:
            return "Loading stopped";
        case 2:
            return "Network error";
        case 3:
            return "Can't decode audio";
        case 4:
            // also what browsers report for a 404 or an unreachable URL
            return "Can't load audio";
        default:
            return "Audio unavailable";
    }
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

    let audio: HTMLAudioElement | undefined;
    let track: HTMLDivElement | undefined;

    const [playing, setPlaying] = createSignal(false);
    const [currentTime, setCurrentTime] = createSignal(0);
    const [duration, setDuration] = createSignal(Number.NaN);
    const [muted, setMuted] = createSignal(false);
    const [volume, setVolume] = createSignal(1);
    const [rate, setRate] = createSignal(1);
    const [loop, setLoop] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    // measured track box and the bar token in px; before measurement (or
    // without layout) the bar is 2, the token's shipped value
    const [trackBox, setTrackBox] = createSignal({ width: 0, height: 0, bar: 2 });
    const clipId = `paper-audio-wave-${createUniqueId()}`;
    const [decoded, setDecoded] = createSignal<number[] | null>(null);
    const [waveformState, setWaveformState] = createSignal<PaperAudioWaveformState>("loading");

    const menu = useContextMenuState("below");

    const fail = (message: string) => {
        setError(message);
        setPlaying(false);
        local.onError?.(message);
    };

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

    // timeupdate fires about four times a second; follow the playhead per
    // frame while playing so the bars fill smoothly
    let frame: number | undefined;
    const stopFrames = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
    };
    const tick = () => {
        if (!audio || audio.paused) {
            frame = undefined;
            return;
        }
        setCurrentTime(audio.currentTime);
        frame = requestAnimationFrame(tick);
    };
    createEffect(() => {
        if (playing() && frame === undefined && typeof requestAnimationFrame === "function") {
            frame = requestAnimationFrame(tick);
        } else if (!playing()) {
            stopFrames();
        }
    });

    onCleanup(() => {
        stopFrames();
        audio?.pause();
    });

    const hasDuration = () => Number.isFinite(duration()) && duration() > 0;
    const progress = () =>
        hasDuration() ? Math.min(1, Math.max(0, currentTime() / duration())) : 0;
    const started = () => playing() || currentTime() > 0;
    // Before playback starts the readout is the length; after, the position.
    const readout = () => formatAudioTime(started() ? currentTime() : duration());
    const effectiveVolume = () => (muted() ? 0 : volume());

    const togglePlay = async () => {
        if (!audio) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        try {
            await audio.play();
        } catch (err) {
            // A pause() while play() is pending rejects with AbortError: the
            // listener asked to stop, which is not a playback failure.
            if (err instanceof DOMException && err.name === "AbortError") return;
            fail(
                err instanceof DOMException && err.name === "NotAllowedError"
                    ? "Playback blocked"
                    : mediaErrorMessage(audio.error),
            );
        }
    };

    const retry = () => {
        if (!audio) return;
        setError(null);
        audio.load();
    };

    const seekTo = (seconds: number) => {
        if (!audio || !hasDuration()) return;
        audio.currentTime = Math.min(duration(), Math.max(0, seconds));
        setCurrentTime(audio.currentTime);
    };

    const onSeekKey: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (e) => {
        const step =
            e.key === "ArrowRight" || e.key === "ArrowUp"
                ? SEEK_STEP_SECONDS
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? -SEEK_STEP_SECONDS
                  : null;
        if (step !== null) {
            e.preventDefault();
            seekTo(currentTime() + step);
        } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            seekTo(e.key === "Home" ? 0 : duration());
        }
    };

    const setVolumeLevel = (value: number) => {
        if (!audio) return;
        audio.volume = Math.min(1, Math.max(0, value));
        audio.muted = value === 0;
    };

    const toggleMute = () => {
        if (!audio) return;
        // unmuting from a dragged-to-zero volume would otherwise stay silent
        if (audio.muted && audio.volume === 0) audio.volume = 1;
        audio.muted = !audio.muted;
    };

    // The volume slider lives in a portal so a clipping ancestor (a card, a
    // scroll pane) cannot cut it off. Being outside the row's tab order, its
    // keyboard path is the volume button itself: arrows change the level.
    let volumeButton: HTMLButtonElement | undefined;
    let volumePopover: HTMLDivElement | undefined;
    let volumeCloseTimer: number | undefined;
    const [volumeOpen, setVolumeOpen] = createSignal(false);
    const [volumePos, setVolumePos] = createSignal({ left: 0, top: 0, below: false });

    const cancelVolumeClose = () => {
        if (volumeCloseTimer !== undefined) clearTimeout(volumeCloseTimer);
        volumeCloseTimer = undefined;
    };
    const openVolume = () => {
        cancelVolumeClose();
        if (!volumeButton) return;
        setVolumeOpen(true);
        const r = volumeButton.getBoundingClientRect();
        const below = r.top - (volumePopover?.offsetHeight ?? 0) < 0;
        setVolumePos({ left: r.left + r.width / 2, top: below ? r.bottom : r.top, below });
    };
    const scheduleVolumeClose = () => {
        cancelVolumeClose();
        volumeCloseTimer = window.setTimeout(() => {
            volumeCloseTimer = undefined;
            setVolumeOpen(false);
        }, VOLUME_CLOSE_DELAY_MS);
    };
    createEffect(() => {
        if (!volumeOpen()) return;
        // a fixed popover would drift from its button; close instead
        const close = () => setVolumeOpen(false);
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        onCleanup(() => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        });
    });
    onCleanup(cancelVolumeClose);

    const onVolumeKey: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (e) => {
        const step =
            e.key === "ArrowUp" || e.key === "ArrowRight"
                ? VOLUME_STEP
                : e.key === "ArrowDown" || e.key === "ArrowLeft"
                  ? -VOLUME_STEP
                  : null;
        if (step === null) return;
        e.preventDefault();
        openVolume();
        setVolumeLevel(Math.round((effectiveVolume() + step) * 100) / 100);
    };

    const toggleMenu = (e: MouseEvent) => {
        if (menu.isOpen()) menu.close();
        else menu.openBelow(e);
    };

    const className = () =>
        [
            styles.PaperAudio,
            local.fullWidth ? styles.fullWidth : "",
            error() ? styles.failed : "",
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
                ref={audio}
                src={local.src}
                preload={local.preload ?? "metadata"}
                loop={loop()}
                onLoadStart={() => setError(null)}
                onEmptied={() => {
                    setPlaying(false);
                    setCurrentTime(0);
                    setDuration(Number.NaN);
                }}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={(e) => {
                    setPlaying(false);
                    setCurrentTime(e.currentTarget.currentTime);
                }}
                onEnded={() => setPlaying(false)}
                onVolumeChange={(e) => {
                    setMuted(e.currentTarget.muted);
                    setVolume(e.currentTarget.volume);
                }}
                onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
                onError={(e) => fail(mediaErrorMessage(e.currentTarget.error))}
            />

            <PaperButton
                icon
                size="small"
                class={styles.play}
                aria-label={playing() ? "Pause" : "Play"}
                disabled={error() !== null}
                onClick={() => void togglePlay()}
            >
                {playing() ? "pause" : "play_arrow"}
            </PaperButton>

            <div class={styles.track} ref={track} data-waveform={waveformState()}>
                <Show
                    when={error() === null}
                    fallback={
                        <div class={styles.error} role="alert">
                            <span class={styles.errorText}>{error()}</span>
                            <PaperButton size="tiny" onClick={retry}>
                                Retry
                            </PaperButton>
                        </div>
                    }
                >
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
                                width={waveformFillWidth(progress(), layout(), trackBox().bar)}
                                height={waveHeight()}
                            />
                        </g>
                    </svg>
                    <input
                        class={styles.range}
                        type="range"
                        min={0}
                        max={hasDuration() ? duration() : 0}
                        step="any"
                        value={currentTime()}
                        disabled={!hasDuration()}
                        aria-label="Seek"
                        aria-valuetext={`${formatAudioTime(currentTime())} of ${formatAudioTime(duration())}`}
                        onInput={(e) => seekTo(Number(e.currentTarget.value))}
                        onKeyDown={onSeekKey}
                    />
                </Show>
            </div>

            <Show when={error() === null}>
                <span class={styles.time}>{readout()}</span>
            </Show>

            {/* volume and options sit together, tighter than the row gap */}
            <div class={styles.actions}>
                <PaperButton
                    ref={volumeButton}
                    icon
                    size="small"
                    variant="text"
                    aria-label={muted() ? "Unmute" : "Mute"}
                    aria-description={`Volume ${Math.round(effectiveVolume() * 100)}%. Arrow keys change it.`}
                    onClick={toggleMute}
                    onKeyDown={onVolumeKey}
                    onPointerEnter={openVolume}
                    onPointerLeave={scheduleVolumeClose}
                    onFocus={openVolume}
                    onBlur={scheduleVolumeClose}
                >
                    {effectiveVolume() === 0
                        ? "volume_off"
                        : effectiveVolume() < 0.5
                          ? "volume_down"
                          : "volume_up"}
                </PaperButton>
                <Show when={volumeOpen()}>
                    <Portal>
                        <div
                            ref={volumePopover}
                            class={styles.volumePopover}
                            classList={{ [styles.below]: volumePos().below }}
                            style={{ left: `${volumePos().left}px`, top: `${volumePos().top}px` }}
                            onPointerEnter={cancelVolumeClose}
                            onPointerLeave={scheduleVolumeClose}
                        >
                            <div class={styles.volumeBox}>
                                <PaperRange
                                        orientation="vertical"
                                    min={0}
                                    max={1}
                                    step={VOLUME_STEP}
                                    value={effectiveVolume()}
                                    tabIndex={-1}
                                    aria-label="Volume"
                                    valueText={(v) => `${Math.round(v * 100)}%`}
                                    onInput={setVolumeLevel}
                                />
                            </div>
                        </div>
                    </Portal>
                </Show>

                <PaperButton
                    icon
                    size="small"
                    variant="text"
                    aria-label="Audio options"
                    aria-haspopup="menu"
                    aria-expanded={menu.isOpen()}
                    onClick={toggleMenu}
                >
                    more_vert
                </PaperButton>
            </div>

            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuSub label="Playback speed" icon="speed">
                    <For each={PAPER_AUDIO_RATES}>
                        {(r) => (
                            <PaperContextMenuItem
                                value={`speed-${r}`}
                                checked={rate() === r}
                                onClick={() => {
                                    if (audio) audio.playbackRate = r;
                                }}
                            >
                                {r === 1 ? "Normal" : `${r}x`}
                            </PaperContextMenuItem>
                        )}
                    </For>
                </PaperContextMenuSub>
                <PaperContextMenuItem
                    value="loop"
                    icon="repeat"
                    checked={loop()}
                    onClick={() => setLoop(!loop())}
                >
                    Loop
                </PaperContextMenuItem>
            </PaperContextMenu>
        </div>
    );
}
