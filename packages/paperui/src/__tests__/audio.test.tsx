import { render, fireEvent, cleanup, screen } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    PaperAudio,
    PAPER_AUDIO_FALLBACK_BARS,
    waveformFillWidth,
    waveformLayout,
    computePeaks,
    formatAudioTime,
    loadWaveform,
    resamplePeaks,
} from "../components/PaperAudio";

// jsdom has no media pipeline: play/pause/load are stubs that we drive by
// dispatching the events a real element would fire.
let playImpl: (el: HTMLMediaElement) => Promise<void>;

beforeEach(() => {
    playImpl = (el) => {
        el.dispatchEvent(new Event("play"));
        return Promise.resolve();
    };
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
        this: HTMLMediaElement,
    ) {
        return playImpl(this);
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
        this: HTMLMediaElement,
    ) {
        this.dispatchEvent(new Event("pause"));
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (
        this: HTMLMediaElement,
    ) {
        this.dispatchEvent(new Event("loadstart"));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function setup(props: Partial<Parameters<typeof PaperAudio>[0]> = {}) {
    const utils = render(() => <PaperAudio src="/clip.mp3" waveform={false} {...props} />);
    const audio = utils.container.querySelector("audio")!;
    const loadMetadata = (duration: number) => {
        Object.defineProperty(audio, "duration", { value: duration, configurable: true });
        audio.dispatchEvent(new Event("loadedmetadata"));
    };
    const track = () => utils.container.querySelector<HTMLElement>("[data-waveform]")!;
    const barHeights = () =>
        Array.from(track().querySelectorAll("clipPath rect")).map((b) => Number(b.getAttribute("height")));
    const fillWidth = () => Number(track().querySelector("[data-progress]")!.getAttribute("width"));
    const waveWidth = () => Number(track().querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]);
    return { ...utils, audio, loadMetadata, track, barHeights, fillWidth, waveWidth };
}

/** A decoder whose single channel ramps from silence to full scale. */
function stubDecoder() {
    const channel = new Float32Array(4096).map((_, i) => i / 4096);
    const decode = vi.fn(async () => ({
        numberOfChannels: 1,
        getChannelData: () => channel,
    }));
    vi.stubGlobal(
        "OfflineAudioContext",
        class {
            decodeAudioData = decode;
        },
    );
    return decode;
}

describe("PaperAudio", () => {
    it("names the group and shows the length before playback starts", () => {
        const { getByRole, getByText, loadMetadata } = setup({ label: "Clip" });
        expect(getByRole("group", { name: "Clip" })).toBeTruthy();
        expect(getByText("0:00")).toBeTruthy();
        loadMetadata(83);
        expect(getByText("1:23")).toBeTruthy();
    });

    it("is compact unless fullWidth is set", () => {
        const compact = setup().getByRole("group");
        expect(compact.className).not.toContain("fullWidth");
        cleanup();
        expect(setup({ fullWidth: true }).getByRole("group").className).toContain("fullWidth");
    });

    it("plays and pauses through the play button, following element events", async () => {
        const { getByRole, audio } = setup();
        fireEvent.click(getByRole("button", { name: "Play" }));
        await Promise.resolve();
        expect(audio.play).toHaveBeenCalled();
        const pause = getByRole("button", { name: "Pause" });
        Object.defineProperty(audio, "paused", { value: false, configurable: true });
        fireEvent.click(pause);
        expect(audio.pause).toHaveBeenCalled();
        expect(getByRole("button", { name: "Play" })).toBeTruthy();
    });

    it("shows the position once playback has started", () => {
        const { getByText, audio, loadMetadata } = setup();
        loadMetadata(83);
        Object.defineProperty(audio, "currentTime", { value: 6, configurable: true, writable: true });
        audio.dispatchEvent(new Event("timeupdate"));
        expect(getByText("0:06")).toBeTruthy();
    });

    it("seeks by pointer and by five second arrow steps, sliding the fill under the waveform", () => {
        const { getByRole, audio, loadMetadata, barHeights, fillWidth, waveWidth } = setup();
        expect(barHeights().length).toBe(PAPER_AUDIO_FALLBACK_BARS);
        expect(fillWidth()).toBe(0);
        const seek = getByRole("slider", { name: "Seek" }) as HTMLInputElement;
        expect(seek.disabled).toBe(true);
        loadMetadata(100);
        expect(seek.disabled).toBe(false);
        seek.value = "50";
        fireEvent.input(seek);
        expect(audio.currentTime).toBe(50);
        const layout = waveformLayout(0, 2);
        expect(fillWidth()).toBeCloseTo(waveformFillWidth(0.5, layout, 2));
        expect(fillWidth()).toBeGreaterThan(waveWidth() * 0.49);
        expect(fillWidth()).toBeLessThan(waveWidth() * 0.51);
        // a linear fill ends at 127 here, inside a gap where no bar shows it
        expect((fillWidth() - layout.offset) % layout.pitch).toBeLessThanOrEqual(2);
        // the fill is continuous, not whole bars: 50.5% is not 50%
        seek.value = "50.5";
        fireEvent.input(seek);
        expect(fillWidth()).toBeCloseTo(waveformFillWidth(0.505, layout, 2));
        expect(fillWidth()).toBeGreaterThan(waveformFillWidth(0.5, layout, 2));
        seek.value = "50";
        fireEvent.input(seek);

        fireEvent.keyDown(seek, { key: "ArrowRight" });
        expect(audio.currentTime).toBe(55);
        fireEvent.keyDown(seek, { key: "ArrowLeft" });
        fireEvent.keyDown(seek, { key: "ArrowLeft" });
        expect(audio.currentTime).toBe(45);
        fireEvent.keyDown(seek, { key: "End" });
        expect(audio.currentTime).toBe(100);
    });

    it("surfaces a rejected play() with a retry that reloads the source", async () => {
        const onError = vi.fn();
        playImpl = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
        const { getByRole, audio } = setup({ onError });
        fireEvent.click(getByRole("button", { name: "Play" }));
        await vi.waitFor(() => expect(getByRole("alert").textContent).toContain("Playback blocked"));
        expect(onError).toHaveBeenCalledWith("Playback blocked");
        expect((getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(getByRole("button", { name: "Retry" }));
        expect(audio.load).toHaveBeenCalled();
        expect(() => getByRole("alert")).toThrow();
        expect((getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("treats a play() aborted by pause as a stop, not a failure", async () => {
        const onError = vi.fn();
        playImpl = () => Promise.reject(new DOMException("interrupted", "AbortError"));
        const { getByRole, queryByRole } = setup({ onError });
        fireEvent.click(getByRole("button", { name: "Play" }));
        await Promise.resolve();
        await Promise.resolve();
        expect(queryByRole("alert")).toBeNull();
        expect(onError).not.toHaveBeenCalled();
    });

    it("reports a media element error instead of an idle player", () => {
        const { getByRole, audio } = setup();
        Object.defineProperty(audio, "error", { value: { code: 4 }, configurable: true });
        audio.dispatchEvent(new Event("error"));
        expect(getByRole("alert").textContent).toContain("Can't load audio");
        expect(getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("toggles mute from the volume button", () => {
        const { getByRole, audio } = setup();
        fireEvent.click(getByRole("button", { name: "Mute" }));
        expect(audio.muted).toBe(true);
        audio.dispatchEvent(new Event("volumechange"));
        expect(getByRole("button", { name: "Unmute" })).toBeTruthy();
    });

    it("shows the volume slider on hover, outside the player so no ancestor clips it", async () => {
        const { getByRole, audio } = setup();
        const button = getByRole("button", { name: "Mute" });
        expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull();
        fireEvent.pointerEnter(button);
        const slider = screen.getByRole("slider", { name: "Volume" });
        expect(getByRole("group").contains(slider)).toBe(false);
        expect(slider.getAttribute("aria-orientation")).toBe("vertical");

        fireEvent.keyDown(slider, { key: "ArrowDown" });
        expect(audio.volume).toBeCloseTo(0.95);
        expect(audio.muted).toBe(false);

        fireEvent.keyDown(slider, { key: "Home" });
        expect(audio.muted).toBe(true);
        audio.dispatchEvent(new Event("volumechange"));
        expect(slider.getAttribute("aria-valuetext")).toBe("0%");

        fireEvent.click(getByRole("button", { name: "Unmute" }));
        expect(audio.muted).toBe(false);
        expect(audio.volume).toBe(1);
        audio.dispatchEvent(new Event("volumechange"));

        // leaving the button closes it after a grace period that moving
        // onto the slider cancels
        fireEvent.pointerLeave(getByRole("button", { name: "Mute" }));
        const popover = slider.parentElement!.parentElement!;
        fireEvent.pointerEnter(popover);
        await new Promise((r) => setTimeout(r, 200));
        expect(screen.queryByRole("slider", { name: "Volume" })).not.toBeNull();
        fireEvent.pointerLeave(popover);
        await vi.waitFor(() => expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull());
    });

    it("changes volume with arrow keys on the focused volume button", async () => {
        const { getByRole, audio } = setup();
        const button = getByRole("button", { name: "Mute" });
        fireEvent.focus(button);
        expect(screen.getByRole("slider", { name: "Volume" })).toBeTruthy();
        fireEvent.keyDown(button, { key: "ArrowDown" });
        await vi.waitFor(() =>
            expect(button.getAttribute("aria-description")).toContain("Volume 95%"),
        );
        fireEvent.keyDown(button, { key: "ArrowUp" });
        await vi.waitFor(() =>
            expect(button.getAttribute("aria-description")).toContain("Volume 100%"),
        );
        expect(audio.volume).toBeCloseTo(1);
    });

    it("puts playback speed in a submenu reachable from the keyboard, and loop beside it", () => {
        const { getByRole, audio } = setup();
        const more = getByRole("button", { name: "Audio options" });
        expect(more.getAttribute("aria-haspopup")).toBe("menu");
        fireEvent.click(more);
        expect(more.getAttribute("aria-expanded")).toBe("true");

        fireEvent.click(screen.getByText("Loop"));
        expect(audio.loop).toBe(true);

        fireEvent.click(more);
        expect(screen.queryByText("1.5x")).toBeNull();
        fireEvent.keyDown(window, { key: "ArrowDown" });
        fireEvent.keyDown(window, { key: "ArrowRight" });
        for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "ArrowDown" });
        fireEvent.keyDown(window, { key: "Enter" });
        expect(audio.playbackRate).toBe(1.5);
        audio.dispatchEvent(new Event("ratechange"));

        fireEvent.click(more);
        fireEvent.click(screen.getByText("Playback speed"));
        const item = screen.getByText("1.5x").closest("[role='menuitem']")!;
        expect(item.querySelector("[class*='itemCheck']")).toBeTruthy();
    });
});

describe("PaperAudio waveform", () => {
    it("decodes the source and draws its waveform", async () => {
        const decode = stubDecoder();
        const fetchMock = vi.fn(async () => new Response(new Uint8Array(64)));
        vi.stubGlobal("fetch", fetchMock);
        const { track, barHeights } = setup({ waveform: true });
        expect(track().dataset.waveform).toBe("loading");
        await vi.waitFor(() => expect(track().dataset.waveform).toBe("ready"));
        expect(fetchMock).toHaveBeenCalledWith("/clip.mp3", expect.anything());
        expect(decode).toHaveBeenCalled();
        const heights = barHeights();
        expect(heights[0]).not.toBe(heights[heights.length - 1]);
        // a full-scale bar spans three quarters of the track height (32 unmeasured)
        expect(heights[heights.length - 1]).toBe(24);
    });

    it("marks the waveform unavailable when the fetch fails, and keeps playback usable", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
        const { track, getByRole } = setup({ waveform: true });
        await vi.waitFor(() => expect(track().dataset.waveform).toBe("unavailable"));
        expect((getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("refuses a source over the byte cap without reading it", async () => {
        const cancel = vi.fn();
        const body = new ReadableStream({ cancel });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(body, { headers: { "content-length": "5000" } })),
        );
        const { track } = setup({ waveform: true, waveformMaxBytes: 1000 });
        await vi.waitFor(() => expect(track().dataset.waveform).toBe("unavailable"));
        expect(cancel).toHaveBeenCalled();
    });

    it("aborts the waveform fetch when the player unmounts", async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn((_: string, init: RequestInit) => {
                signal = init.signal!;
                // like a real fetch: pending until aborted, then rejects
                return new Promise((_, reject) =>
                    signal!.addEventListener("abort", () => reject(signal!.reason)),
                );
            }),
        );
        const { unmount } = setup({ waveform: true });
        await vi.waitFor(() => expect(signal).toBeDefined());
        unmount();
        expect(signal!.aborted).toBe(true);
    });

    it("uses caller peaks without fetching", () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { track } = setup({ waveform: true, peaks: [0.1, 1] });
        expect(track().dataset.waveform).toBe("ready");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("decodes at most two sources at once and releases queued slots on abort", async () => {
        stubDecoder();
        const pending: Array<() => void> = [];
        const fetchMock = vi.fn(
            (_url: string) => new Promise<Response>((resolve) => pending.push(() => resolve(new Response(new Uint8Array(8))))),
        );
        vi.stubGlobal("fetch", fetchMock);
        const a = new AbortController();
        const b = new AbortController();
        const c = new AbortController();
        const d = new AbortController();
        const first = loadWaveform("/a", a.signal);
        const second = loadWaveform("/b", b.signal);
        const third = loadWaveform("/c", c.signal);
        const fourth = loadWaveform("/d", d.signal);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await new Promise((r) => setTimeout(r, 10));
        expect(fetchMock).toHaveBeenCalledTimes(2);

        c.abort();
        await expect(third).rejects.toBeDefined();
        pending[0]();
        await first;
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls[2][0]).toBe("/d");
        pending[1]();
        pending[2]();
        await Promise.all([second, fourth]);
    });
});

describe("PaperAudio helpers", () => {
    it("formats seconds as m:ss and h:mm:ss", () => {
        expect(formatAudioTime(Number.NaN)).toBe("0:00");
        expect(formatAudioTime(6.9)).toBe("0:06");
        expect(formatAudioTime(83)).toBe("1:23");
        expect(formatAudioTime(3723)).toBe("1:02:03");
    });

    it("resamples peaks to the bar count by bucket maximum", () => {
        expect(resamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
        expect(resamplePeaks([0.1, 0.9, 0.2, 0.4, 0.3, 0.5, 2, Number.NaN], 4)).toEqual([
            0.9, 0.4, 0.5, 1,
        ]);
        expect(resamplePeaks([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
        expect(resamplePeaks(new Array(10_000).fill(0.2), 50).length).toBe(50);
    });

    it("computes normalized per-bucket peaks across channels", () => {
        const left = new Float32Array([0, 0.1, -0.2, 0, 0, 0, 0, 0]);
        const right = new Float32Array([0, 0, 0, 0, 0, 0, 0, -0.4]);
        expect(computePeaks([left, right], 4)).toEqual([0.25, 0.5, 0, 1]);
        expect(computePeaks([new Float32Array(4)], 2)).toEqual([0, 0]);
    });

    it("advances the fill through bars only, never idling in a gap", () => {
        const bar = 2;
        const layout = waveformLayout(300, bar);
        expect(waveformFillWidth(0, layout, bar)).toBe(layout.offset);
        expect(waveformFillWidth(1, layout, bar)).toBe(layout.width);
        let previous = -Infinity;
        for (let i = 0; i < 1000; i++) {
            const x = waveformFillWidth(i / 1000, layout, bar);
            expect(x).toBeGreaterThan(previous);
            previous = x;
            // the leading edge lies inside a bar, never within a gap
            const intoPitch = (x - layout.offset) % layout.pitch;
            expect(intoPitch).toBeLessThanOrEqual(bar + 1e-9);
        }
        // inside a bar, equal time moves the edge an equal distance
        const quarterBar = 1 / (layout.count * 4);
        const a = waveformFillWidth(10 * 4 * quarterBar, layout, bar);
        const b = waveformFillWidth(11 * 4 * quarterBar - 2 * quarterBar, layout, bar);
        const c = waveformFillWidth(11 * 4 * quarterBar - quarterBar, layout, bar);
        expect(c - b).toBeCloseTo(bar / 4);
        expect(b - a).toBeCloseTo(bar / 2);
    });
});
