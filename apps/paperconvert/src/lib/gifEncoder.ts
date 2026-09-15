// ─── Browser GIF Encoder powered by gifenc ─────────────────────────────────
// Supports single images, image sequences, and HTML5 video scrubbing (MP4/WebM/MOV).
//
// "Really Good GIF Encoder" toggle:
// - Max dimensions capped at 480px width (preserving aspect ratio)
// - Frame rate locked to 15 FPS (66ms delay) — the Tenor/Discord golden standard
// - Global 128-color palette sampled across all frames via NeuQuant/rgb565
// - Shared color table across frames for maximum LZW compression (keeps files under 2-4MB)
//
// Normal GIF mode:
// - User-defined dimensions (or original)
// - 256 colors per frame (or user-chosen palette size)
// - Configurable FPS

import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ConvertOptions } from "./imageConverter";

export interface GifFrameData {
  rgba: Uint8Array;
  width: number;
  height: number;
  delayMs: number;
}

/**
 * Extracts frames from an HTML5-playable video file (MP4, WebM, MOV)
 * using the browser's hardware GPU decoder.
 */
export async function extractVideoFrames(
  file: File,
  fps: number,
  maxDurationSec: number,
  targetWidth?: number,
  targetHeight?: number,
  onProgress?: (ratio: number) => void,
): Promise<{ frames: Uint8Array[]; width: number; height: number; delayMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = async () => {
      try {
        const origW = video.videoWidth || 480;
        const origH = video.videoHeight || 360;
        let w = origW;
        let h = origH;

        if (targetWidth && targetHeight) {
          w = targetWidth;
          h = targetHeight;
        } else if (targetWidth) {
          w = targetWidth;
          h = Math.max(1, Math.round((origH * targetWidth) / origW));
        } else if (targetHeight) {
          h = targetHeight;
          w = Math.max(1, Math.round((origW * targetHeight) / origH));
        }

        const duration = Math.min(video.duration || 5, maxDurationSec);
        const interval = 1 / fps;
        const delayMs = Math.round(interval * 1000);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D context unavailable.");

        const frames: Uint8Array[] = [];
        let currentTime = 0;

        const captureFrame = (time: number): Promise<Uint8Array> => {
          return new Promise((res) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              ctx.drawImage(video, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              res(new Uint8Array(imgData.data.buffer));
            };
            video.addEventListener("seeked", onSeeked);
            video.currentTime = Math.min(time, video.duration);
          });
        };

        const totalFrames = Math.max(1, Math.floor(duration * fps));
        for (let i = 0; i < totalFrames; i++) {
          const frameRgba = await captureFrame(currentTime);
          frames.push(frameRgba);
          currentTime += interval;
          if (onProgress) onProgress((i + 1) / totalFrames);
        }

        URL.revokeObjectURL(url);
        resolve({ frames, width: w, height: h, delayMs });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Browser could not decode this video file. Ensure it is a valid MP4, WebM, or MOV."));
    };
  });
}

/**
 * Encodes an array of raw RGBA frames into a GIF blob.
 */
export function encodeGifFromFrames(
  frames: Uint8Array[],
  width: number,
  height: number,
  delayMs: number,
  reallyGood: boolean,
  colorCount: number = 128,
): Blob {
  const gif = GIFEncoder();
  const format = "rgb565";
  const numColors = reallyGood ? 128 : Math.min(256, Math.max(16, colorCount));

  if (reallyGood || frames.length > 1) {
    // "Really Good" mode: sample pixels across frames to compute a single cohesive
    // global palette. This drastically reduces GIF file size because subsequent
    // frames don't write individual 768-byte color tables and LZW runs compress
    // identical palette indices across frames.
    const sampleLength = Math.min(width * height * 4, 30000);
    const combinedSample = new Uint8Array(frames.length * sampleLength);
    for (let i = 0; i < frames.length; i++) {
      combinedSample.set(frames[i].subarray(0, sampleLength), i * sampleLength);
    }

    const globalPalette = quantize(combinedSample, numColors, { format });

    for (let i = 0; i < frames.length; i++) {
      const index = applyPalette(frames[i], globalPalette, format);
      // Write global palette on first frame, omit on subsequent frames for max compression
      gif.writeFrame(index, width, height, {
        palette: i === 0 ? globalPalette : null,
        delay: delayMs,
        repeat: 0,
      });
    }
  } else {
    // Normal single-frame mode
    const frame = frames[0];
    const palette = quantize(frame, numColors, { format });
    const index = applyPalette(frame, palette, format);
    gif.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
      repeat: 0,
    });
  }

  gif.finish();
  return new Blob([gif.bytes() as unknown as BlobPart], { type: "image/gif" });
}

/**
 * Main GIF converter entry point called from the image/media conversion pipeline.
 */
export async function convertToGif(
  file: File,
  opts: ConvertOptions,
  onProgress?: (ratio: number) => void,
): Promise<{ blob: Blob; width: number; height: number }> {
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
  const reallyGood = opts.reallyGoodGif ?? true;

  if (isVideo) {
    // Video to GIF
    const fps = reallyGood ? 15 : (opts.gifFps ?? 15);
    const maxDurationSec = reallyGood ? 8 : 12;

    let targetW: number | undefined;
    let targetH: number | undefined;

    if (reallyGood) {
      // Tenor standard: max 480px width
      targetW = 480;
    } else {
      if (opts.resizeMode === "width" && opts.width) targetW = opts.width;
      else if (opts.resizeMode === "height" && opts.height) targetH = opts.height;
      else if (opts.resizeMode === "exact" && opts.width && opts.height) {
        targetW = opts.width;
        targetH = opts.height;
      }
    }

    const { frames, width, height, delayMs } = await extractVideoFrames(
      file,
      fps,
      maxDurationSec,
      targetW,
      targetH,
      onProgress,
    );

    const blob = encodeGifFromFrames(
      frames,
      width,
      height,
      delayMs,
      reallyGood,
      opts.gifColors ?? 128,
    );

    return { blob, width, height };
  }

  // Static Image to GIF
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image for GIF encoding."));
      el.src = imgUrl;
    });

    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    if (reallyGood) {
      // Cap at 480px width if larger, preserving aspect ratio
      if (w > 480) {
        h = Math.max(1, Math.round((h * 480) / w));
        w = 480;
      }
    } else if (opts.resizeMode === "width" && opts.width) {
      h = Math.max(1, Math.round((h * opts.width) / w));
      w = opts.width;
    } else if (opts.resizeMode === "height" && opts.height) {
      w = Math.max(1, Math.round((w * opts.height) / h));
      h = opts.height;
    } else if (opts.resizeMode === "exact" && opts.width && opts.height) {
      w = opts.width;
      h = opts.height;
    } else if (opts.resizeMode === "percent" && opts.percent) {
      const p = opts.percent / 100;
      w = Math.max(1, Math.round(w * p));
      h = Math.max(1, Math.round(h * p));
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D unavailable.");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const rgba = new Uint8Array(imgData.data.buffer);

    const blob = encodeGifFromFrames(
      [rgba],
      w,
      h,
      100, // 100ms static delay
      reallyGood,
      opts.gifColors ?? 128,
    );

    return { blob, width: w, height: h };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}
