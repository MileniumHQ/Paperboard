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
}

// WebKit on the iPhone has no element fullscreen; its video element has its own
type WebKitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

/**
 * A video with PaperAudio's controls under it: play, a seek track, the
 * time, volume, fullscreen and the options menu (speed and loop). A press
 * on the picture plays or pauses it. It is as wide as its picture, up to
 * its container, and never taller than `--paper-video-max-height`.
 */
export function PaperVideo(props: PaperVideoProps) {
    const [local, rest] = splitProps(props, ["src", "label", "poster", "preload", "onError", "class", "classList"]);

    let root: HTMLDivElement | undefined;
    let video: WebKitVideo | undefined;
    const player = createMediaPlayer({ noun: "video", onError: (message) => local.onError?.(message) });
    const [fullscreen, setFullscreen] = createSignal(false);
    const [canFullscreen, setCanFullscreen] = createSignal(false);

    onMount(() => {
        setCanFullscreen((!!root?.requestFullscreen && document.fullscreenEnabled !== false) || !!video?.webkitEnterFullscreen);
        const follow = () => setFullscreen(document.fullscreenElement === root);
        document.addEventListener("fullscreenchange", follow);
        onCleanup(() => document.removeEventListener("fullscreenchange", follow));
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
                    playsinline
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
