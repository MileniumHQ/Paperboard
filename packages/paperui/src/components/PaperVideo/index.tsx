import styles from "./index.module.css";
import { createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import {
    createMediaPlayer,
    MediaActions,
    MediaError,
    MediaPlayButton,
    MediaSeek,
    MediaTime,
} from "../shared/media";

export interface PaperVideoProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    src: string;
    /** Accessible name for the player group. Defaults to "Video". */
    label?: string;
    /** A picture shown before playback starts. */
    poster?: string;
    preload?: "none" | "metadata" | "auto";
    /** Called with the message shown in the player when playback fails. */
    onError?: (message: string) => void;
    /**
     * Opens in the system's own full-screen player and plays at once, the
     * way a phone shows a video: mount it from a tap. The player stays here
     * underneath, and is what shows if the system refuses.
     */
    nativePlayer?: boolean;
    /** Called when the system's player is left, with `nativePlayer`. */
    onNativePlayerClose?: () => void;
}

// WebKit on the iPhone has no element fullscreen; its video element has its own
type WebKitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** A phone or a tablet: a touch screen is how it's used, with no pointer to hover. */
export const prefersNativeVideo = () =>
    typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;

/**
 * A video with PaperAudio's controls under it: play, a seek track, the
 * time, volume, fullscreen and the options menu (speed and loop). A press
 * on the picture plays or pauses it. It is as wide as its picture, up to
 * its container, and never taller than `--paper-video-max-height`.
 */
export function PaperVideo(props: PaperVideoProps) {
    const [local, rest] = splitProps(props, [
        "src",
        "label",
        "poster",
        "preload",
        "onError",
        "nativePlayer",
        "onNativePlayerClose",
        "class",
        "classList",
    ]);

    let root: HTMLDivElement | undefined;
    let video: WebKitVideo | undefined;
    const player = createMediaPlayer({ noun: "video", onError: (message) => local.onError?.(message) });
    const [fullscreen, setFullscreen] = createSignal(false);
    const [canFullscreen, setCanFullscreen] = createSignal(false);

    // In the system's player: the video's own controls show, and leaving it is
    // reported. Leaving counts only once it was shown, so the events of the
    // way in can't close it.
    let native = false;
    let shown = false;
    const nativeShown = () => {
        if (native) shown = true;
    };
    const leaveNative = () => {
        if (!native || !shown || !video) return;
        native = shown = false;
        video.controls = false;
        local.onNativePlayerClose?.();
    };

    // The iPhone plays a video that isn't marked inline in its own full-screen
    // player, so playing it is the way in. Elsewhere the video itself goes full
    // screen, with its own controls. Refused, it stays in this player.
    const openNative = async () => {
        if (!video) return;
        native = true;
        if (!video.webkitEnterFullscreen) {
            try {
                video.controls = true;
                await video.requestFullscreen();
            } catch {
                native = false;
                video.controls = false;
            }
        }
        await player.togglePlay();
    };

    onMount(() => {
        setCanFullscreen((!!root?.requestFullscreen && document.fullscreenEnabled !== false) || !!video?.webkitEnterFullscreen);
        const follow = () => {
            setFullscreen(document.fullscreenElement === root);
            if (document.fullscreenElement === video) nativeShown();
            else leaveNative();
        };
        document.addEventListener("fullscreenchange", follow);
        video?.addEventListener("webkitbeginfullscreen", nativeShown);
        video?.addEventListener("webkitendfullscreen", leaveNative);
        onCleanup(() => {
            document.removeEventListener("fullscreenchange", follow);
            video?.removeEventListener("webkitbeginfullscreen", nativeShown);
            video?.removeEventListener("webkitendfullscreen", leaveNative);
        });
        if (local.nativePlayer) void openNative();
    });

    const toggleFullscreen = async () => {
        if (!root || !video) return;
        if (document.fullscreenElement === root) {
            await document.exitFullscreen();
            return;
        }
        if (root.requestFullscreen && document.fullscreenEnabled !== false) {
            await root.requestFullscreen();
            return;
        }
        video.webkitEnterFullscreen?.();
    };

    const notStarted = () => !player.playing() && player.currentTime() === 0 && player.error() === null;

    return (
        <div
            role="group"
            aria-label={local.label ?? "Video"}
            {...rest}
            ref={root}
            class={[styles.PaperVideo, fullscreen() ? styles.fullscreen : "", local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            {/* the picture is a big play button for the pointer; the bar's
                play button is the one for keys and screen readers */}
            <div class={styles.stage} onClick={() => void player.togglePlay()}>
                <video
                    {...player.element}
                    ref={(el) => {
                        video = el;
                        player.element.ref(el);
                    }}
                    class={styles.video}
                    src={local.src}
                    poster={local.poster}
                    preload={local.preload ?? "metadata"}
                    loop={player.loop()}
                    playsinline={!local.nativePlayer}
                />
                <Show when={notStarted()}>
                    <span class={styles.bigPlay} aria-hidden="true">
                        <PaperIcon>play_arrow</PaperIcon>
                    </span>
                </Show>
            </div>

            <div class={styles.bar}>
                <MediaPlayButton player={player} />
                <div class={styles.track}>
                    <Show when={player.error() === null} fallback={<MediaError player={player} />}>
                        <div class={styles.rail} aria-hidden="true">
                            <div class={styles.fill} style={{ width: `${player.progress() * 100}%` }} />
                        </div>
                        <MediaSeek player={player} />
                    </Show>
                </div>
                <MediaTime player={player} />
                <MediaActions player={player} label="Video options">
                    <Show when={canFullscreen()}>
                        <PaperButton
                            icon
                            size="small"
                            variant="text"
                            aria-label={fullscreen() ? "Exit full screen" : "Full screen"}
                            onClick={() => void toggleFullscreen()}
                        >
                            {fullscreen() ? "fullscreen_exit" : "fullscreen"}
                        </PaperButton>
                    </Show>
                </MediaActions>
            </div>
        </div>
    );
}
