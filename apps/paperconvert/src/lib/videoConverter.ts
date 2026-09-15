// ─── Browser Video Transcoder ──────────────────────────────────────────────
// Converts video files (MP4, WebM, MOV) to MP4 or WebM using hardware-accelerated
// in-browser GPU encoders (Canvas stream + MediaRecorder), with resolution scaling,
// FPS selection, bitrate control, and audio muting. Zero uploads.

import type { ConvertOptions } from "./imageConverter";

export function getSupportedVideoMime(target: "mp4" | "webm"): string {
  if (target === "mp4") {
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) return "video/mp4;codecs=avc1";
      if (MediaRecorder.isTypeSupported("video/mp4")) return "video/mp4";
    }
    return "video/webm;codecs=vp9";
  }

  if (typeof MediaRecorder !== "undefined") {
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8";
    if (MediaRecorder.isTypeSupported("video/webm")) return "video/webm";
  }

  return "video/webm";
}

export async function convertVideo(
  file: File,
  target: "mp4" | "webm",
  opts: ConvertOptions,
  onProgress?: (ratio: number) => void,
): Promise<{ blob: Blob; width: number; height: number; mime: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    // Autoplay policy: video MUST be muted for background play() to be allowed
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.style.position = "fixed";
    video.style.top = "-9999px";
    video.style.left = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.appendChild(video);

    const url = URL.createObjectURL(file);
    video.src = url;

    let isDone = false;
    const cleanup = () => {
      isDone = true;
      video.pause();
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.onloadedmetadata = async () => {
      try {
        const origW = video.videoWidth || 640;
        const origH = video.videoHeight || 360;
        let outW = origW;
        let outH = origH;

        if (opts.resizeMode === "width" && opts.width) {
          outW = opts.width;
          outH = Math.round((origH * opts.width) / origW);
        } else if (opts.resizeMode === "height" && opts.height) {
          outH = opts.height;
          outW = Math.round((origW * opts.height) / origH);
        } else if (opts.resizeMode === "exact" && opts.width && opts.height) {
          outW = opts.width;
          outH = opts.height;
        } else if (opts.resizeMode === "percent" && opts.percent) {
          const p = opts.percent / 100;
          outW = Math.round(origW * p);
          outH = Math.round(origH * p);
        }

        // Hardware video encoders require even dimensions
        outW = outW % 2 === 0 ? outW : outW - 1;
        outH = outH % 2 === 0 ? outH : outH - 1;
        outW = Math.max(2, outW);
        outH = Math.max(2, outH);

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable.");

        const fps = opts.videoFps || 30;
        const canvasStream = canvas.captureStream(fps);

        // Attempt to pass audio track if available and not muted
        if (!opts.muteAudio) {
          try {
            const stream = (video as any).captureStream ? (video as any).captureStream() : null;
            const audioTrack = stream?.getAudioTracks()[0];
            if (audioTrack) {
              canvasStream.addTrack(audioTrack);
            }
          } catch {
            // Proceed video-only if audio capture is restricted
          }
        }

        const mimeType = getSupportedVideoMime(target);
        const bitrate = Math.round(
          ((opts.quality || 85) / 100) * (outW * outH > 1280 * 720 ? 4000000 : 2000000) + 500000,
        );

        const recorder = new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: bitrate,
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const finishRecording = async () => {
          if (isDone) return;
          isDone = true;
          cancelAnimationFrame(animId);
          ctx.drawImage(video, 0, 0, outW, outH);

          const resultPromise = new Promise<Blob>((res) => {
            recorder.onstop = () => {
              res(new Blob(chunks, { type: mimeType }));
            };
          });

          recorder.stop();
          const finalBlob = await resultPromise;
          cleanup();
          resolve({
            blob: finalBlob,
            width: outW,
            height: outH,
            mime: mimeType,
          });
        };

        recorder.start(100);

        let animId: number;
        const draw = () => {
          if (isDone) return;
          ctx.drawImage(video, 0, 0, outW, outH);
          const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : null;
          if (onProgress && dur) {
            onProgress(Math.min(1, video.currentTime / dur));
          }
          if (video.ended || (dur && video.currentTime >= dur - 0.05)) {
            finishRecording();
            return;
          }
          animId = requestAnimationFrame(draw);
        };

        video.onplay = () => {
          draw();
        };

        video.onended = () => {
          finishRecording();
        };

        // Safety timeout in case video ends without triggering onended
        const expectedDurationSec = isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
        setTimeout(() => {
          if (!isDone) finishRecording();
        }, (expectedDurationSec + 3) * 1000);

        await video.play();
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Browser could not decode video file."));
    };
  });
}
