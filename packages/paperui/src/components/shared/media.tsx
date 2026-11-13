// What PaperAudio and PaperVideo share: the state of one media element and
// the controls that drive it. The play button, the time, the volume button
// with its slider and the options menu (speed and loop) are the same in
// both; each player brings its own seek track.

import styles from "./media.module.css";
import {
    createEffect,
    createSignal,
    For,
    onCleanup,
    Show,
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

export const PAPER_MEDIA_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;
const VOLUME_CLOSE_DELAY_MS = 150;

export function formatMediaTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = String(whole % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function mediaErrorMessage(error: MediaError | null, noun: string): string {
    switch (error?.code) {
        case 1:
            return "Loading stopped";
        case 2:
            return "Network error";
        case 3:
            return `Can't decode ${noun}`;
        case 4:
            // also what browsers report for a 404 or an unreachable URL
            return `Can't load ${noun}`;
        default:
            return `${noun[0].toUpperCase()}${noun.slice(1)} unavailable`;
    }
}

/**
 * One media element's state, kept from its own events. `noun` names the
 * media in error messages ("audio", "video").
 */
export function createMediaPlayer(options: { noun: string; onError?: (message: string) => void }) {
    let media: HTMLMediaElement | undefined;

    const [playing, setPlaying] = createSignal(false);
    const [currentTime, setCurrentTime] = createSignal(0);
    const [duration, setDuration] = createSignal(Number.NaN);
    const [muted, setMuted] = createSignal(false);
    const [volume, setVolume] = createSignal(1);
    const [rate, setRate] = createSignal(1);
    const [loop, setLoop] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    const fail = (message: string) => {
        setError(message);
        setPlaying(false);
        options.onError?.(message);
    };

    // timeupdate fires about four times a second; follow the playhead per
    // frame while playing so progress moves smoothly
    let frame: number | undefined;
    const stopFrames = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
    };
    const tick = () => {
        if (!media || media.paused) {
            frame = undefined;
            return;
        }
        setCurrentTime(media.currentTime);
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
        media?.pause();
    });

    const hasDuration = () => Number.isFinite(duration()) && duration() > 0;
    const effectiveVolume = () => (muted() ? 0 : volume());
    const started = () => playing() || currentTime() > 0;

    const player = {
        playing,
        currentTime,
        duration,
        muted,
        rate,
        loop,
        error,
        hasDuration,
        effectiveVolume,
        progress: () => (hasDuration() ? Math.min(1, Math.max(0, currentTime() / duration())) : 0),
        // Before playback starts the readout is the length; after, the position.
        readout: () => formatMediaTime(started() ? currentTime() : duration()),

        /** The element's ref and events: spread onto the <audio> or <video>. */
        element: {
            ref: (el: HTMLMediaElement) => {
                media = el;
            },
            onLoadStart: () => setError(null),
            onEmptied: () => {
                setPlaying(false);
                setCurrentTime(0);
                setDuration(Number.NaN);
            },
            onLoadedMetadata: (e: Event & { currentTarget: HTMLMediaElement }) => setDuration(e.currentTarget.duration),
            onDurationChange: (e: Event & { currentTarget: HTMLMediaElement }) => setDuration(e.currentTarget.duration),
            onTimeUpdate: (e: Event & { currentTarget: HTMLMediaElement }) => setCurrentTime(e.currentTarget.currentTime),
            onSeeked: (e: Event & { currentTarget: HTMLMediaElement }) => setCurrentTime(e.currentTarget.currentTime),
            onPlay: () => setPlaying(true),
            onPause: (e: Event & { currentTarget: HTMLMediaElement }) => {
                setPlaying(false);
                setCurrentTime(e.currentTarget.currentTime);
            },
            onEnded: () => setPlaying(false),
            onVolumeChange: (e: Event & { currentTarget: HTMLMediaElement }) => {
                setMuted(e.currentTarget.muted);
                setVolume(e.currentTarget.volume);
            },
            onRateChange: (e: Event & { currentTarget: HTMLMediaElement }) => setRate(e.currentTarget.playbackRate),
            onError: (e: Event & { currentTarget: HTMLMediaElement }) => fail(mediaErrorMessage(e.currentTarget.error, options.noun)),
        },

        async togglePlay() {
            if (!media) return;
            if (!media.paused) {
                media.pause();
                return;
            }
            try {
                await media.play();
            } catch (err) {
                // A pause() while play() is pending rejects with AbortError: the
                // listener asked to stop, which is not a playback failure.
                if (err instanceof DOMException && err.name === "AbortError") return;
                fail(
                    err instanceof DOMException && err.name === "NotAllowedError"
                        ? "Playback blocked"
                        : mediaErrorMessage(media.error, options.noun),
                );
            }
        },

        retry() {
            if (!media) return;
            setError(null);
            media.load();
        },

        seekTo(seconds: number) {
            if (!media || !hasDuration()) return;
            media.currentTime = Math.min(duration(), Math.max(0, seconds));
            setCurrentTime(media.currentTime);
        },

        /** Arrow keys step five seconds, Home and End go to either end. */
        onSeekKey(e: KeyboardEvent) {
            const step =
                e.key === "ArrowRight" || e.key === "ArrowUp"
                    ? SEEK_STEP_SECONDS
                    : e.key === "ArrowLeft" || e.key === "ArrowDown"
                      ? -SEEK_STEP_SECONDS
                      : null;
            if (step !== null) {
                e.preventDefault();
                player.seekTo(currentTime() + step);
            } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                player.seekTo(e.key === "Home" ? 0 : duration());
            }
        },

        setVolumeLevel(value: number) {
            if (!media) return;
            media.volume = Math.min(1, Math.max(0, value));
            media.muted = value === 0;
        },

        toggleMute() {
            if (!media) return;
            // unmuting from a dragged-to-zero volume would otherwise stay silent
            if (media.muted && media.volume === 0) media.volume = 1;
            media.muted = !media.muted;
        },

        setRate(r: number) {
            if (media) media.playbackRate = r;
        },

        toggleLoop: () => setLoop(!loop()),
    };
    return player;
}

export type MediaPlayer = ReturnType<typeof createMediaPlayer>;

/** Play and pause; off while the media has failed. */
export function MediaPlayButton(props: { player: MediaPlayer; class?: string }) {
    return (
        <PaperButton
            icon
            size="small"
            class={[styles.play, props.class].filter(Boolean).join(" ")}
            aria-label={props.player.playing() ? "Pause" : "Play"}
            disabled={props.player.error() !== null}
            onClick={() => void props.player.togglePlay()}
        >
            {props.player.playing() ? "pause" : "play_arrow"}
        </PaperButton>
    );
}

/** What went wrong, with a way to try again; it takes the seek track's place. */
export function MediaError(props: { player: MediaPlayer }) {
    return (
        <div class={styles.error} role="alert">
            <span class={styles.errorText}>{props.player.error()}</span>
            <PaperButton size="tiny" onClick={() => props.player.retry()}>
                Retry
            </PaperButton>
        </div>
    );
}

/**
 * The invisible range over a seek track: it takes the pointer and the keys,
 * and the track under it draws where playback is.
 */
export function MediaSeek(props: { player: MediaPlayer }) {
    const p = props.player;
    return (
        <input
            class={styles.range}
            type="range"
            min={0}
            max={p.hasDuration() ? p.duration() : 0}
            step="any"
            value={p.currentTime()}
            disabled={!p.hasDuration()}
            aria-label="Seek"
            aria-valuetext={`${formatMediaTime(p.currentTime())} of ${formatMediaTime(p.duration())}`}
            onInput={(e) => p.seekTo(Number(e.currentTarget.value))}
            onKeyDown={(e) => p.onSeekKey(e)}
        />
    );
}

export function MediaTime(props: { player: MediaPlayer }) {
    return (
        <Show when={props.player.error() === null}>
            <span class={styles.time}>{props.player.readout()}</span>
        </Show>
    );
}

/**
 * Volume and options, together, tighter than the row's gap. `children` are
 * more buttons that go between them (a video's fullscreen). `label` names
 * the options button ("Audio options").
 */
export function MediaActions(props: { player: MediaPlayer; label: string; children?: JSX.Element }) {
    const p = props.player;
    const menu = useContextMenuState("below");

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
        p.setVolumeLevel(Math.round((p.effectiveVolume() + step) * 100) / 100);
    };

    const toggleMenu = (e: MouseEvent) => {
        if (menu.isOpen()) menu.close();
        else menu.openBelow(e);
    };

    return (
        <div class={styles.actions}>
            <PaperButton
                ref={volumeButton}
                icon
                size="small"
                variant="text"
                aria-label={p.muted() ? "Unmute" : "Mute"}
                aria-description={`Volume ${Math.round(p.effectiveVolume() * 100)}%. Arrow keys change it.`}
                onClick={() => p.toggleMute()}
                onKeyDown={onVolumeKey}
                onPointerEnter={openVolume}
                onPointerLeave={scheduleVolumeClose}
                onFocus={openVolume}
                onBlur={scheduleVolumeClose}
            >
                {p.effectiveVolume() === 0 ? "volume_off" : p.effectiveVolume() < 0.5 ? "volume_down" : "volume_up"}
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
                                value={p.effectiveVolume()}
                                tabIndex={-1}
                                aria-label="Volume"
                                valueText={(v) => `${Math.round(v * 100)}%`}
                                onInput={(v) => p.setVolumeLevel(v)}
                            />
                        </div>
                    </div>
                </Portal>
            </Show>

            {props.children}

            <PaperButton
                icon
                size="small"
                variant="text"
                aria-label={props.label}
                aria-haspopup="menu"
                aria-expanded={menu.isOpen()}
                onClick={toggleMenu}
            >
                more_vert
            </PaperButton>

            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <PaperContextMenuSub label="Playback speed" icon="speed">
                    <For each={PAPER_MEDIA_RATES}>
                        {(r) => (
                            <PaperContextMenuItem value={`speed-${r}`} checked={p.rate() === r} onClick={() => p.setRate(r)}>
                                {r === 1 ? "Normal" : `${r}x`}
                            </PaperContextMenuItem>
                        )}
                    </For>
                </PaperContextMenuSub>
                <PaperContextMenuItem value="loop" icon="repeat" checked={p.loop()} onClick={() => p.toggleLoop()}>
                    Loop
                </PaperContextMenuItem>
            </PaperContextMenu>
        </div>
    );
}
