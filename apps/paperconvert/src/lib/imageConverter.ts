// ─── Local file conversion engine ───────────────────────────────────────────
// 100% client-side via Web APIs (createImageBitmap, OffscreenCanvas, Web Audio,
// HTML5 Video decoder) and in-browser encoders (gifenc, ICO, SheetJS, pdf-lib, heic-decode, utif).
// Zero uploads. Zero servers.

import { mimeFor } from "./formats";
import { convertToGif } from "./gifEncoder";
import { convertToIco } from "./icoEncoder";
import { convertAudio } from "./audioConverter";
import { convertSpreadsheet } from "./spreadsheetConverter";
import {
  convertImageToPdf,
  convertTextToPdf,
  markdownToHtml,
  htmlToMarkdown,
} from "./pdfConverter";
import {
  isHeic,
  isTiff,
  decodeHeicToCanvas,
  decodeTiffToCanvas,
} from "./proImageDecoder";
import { convertVideo } from "./videoConverter";
import { transcodeWithFFmpeg } from "./ffmpegTranscoder";

export interface ConvertOptions {
  target: string;
  quality: number; // 0..100
  resizeMode: "original" | "width" | "height" | "exact" | "percent";
  width?: number;
  height?: number;
  percent?: number;
  background: string;
  autoRotate: boolean;
  progressive: boolean;
  reallyGoodGif: boolean;
  gifFps?: number;
  gifColors?: number;
  videoFps?: number;
  muteAudio?: boolean;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  target: "webp",
  quality: 85,
  resizeMode: "original",
  background: "#ffffff",
  autoRotate: true,
  progressive: false,
  reallyGoodGif: true,
  gifFps: 15,
  gifColors: 128,
  videoFps: 30,
  muteAudio: false,
};

export interface ConvertResult {
  blob: Blob;
  width?: number;
  height?: number;
  mime: string;
  elapsedMs: number;
  fromBytes: number;
  toBytes: number;
}

export function computeOutputSize(
  srcW: number,
  srcH: number,
  opts: ConvertOptions,
): { w: number; h: number } {
  const { resizeMode, width, height, percent } = opts;
  if (resizeMode === "original") return { w: srcW, h: srcH };
  if (resizeMode === "percent") {
    const p = Math.min(400, Math.max(1, percent ?? 100)) / 100;
    return { w: Math.max(1, Math.round(srcW * p)), h: Math.max(1, Math.round(srcH * p)) };
  }
  if (resizeMode === "width" && width) {
    const w = Math.max(1, Math.round(width));
    return { w, h: Math.max(1, Math.round((srcH * w) / srcW)) };
  }
  if (resizeMode === "height" && height) {
    const h = Math.max(1, Math.round(height));
    return { w: Math.max(1, Math.round((srcW * h) / srcH)), h };
  }
  if (resizeMode === "exact") {
    return {
      w: Math.max(1, Math.round(width ?? srcW)),
      h: Math.max(1, Math.round(height ?? srcH)),
    };
  }
  return { w: srcW, h: srcH };
}

async function decodeToBitmap(file: File): Promise<{ bmp: ImageBitmap | HTMLImageElement | HTMLCanvasElement; w: number; h: number; cleanup: () => void }> {
  // 1. HEIC / HEIF decoding
  if (await isHeic(file)) {
    const canvas = await decodeHeicToCanvas(file);
    return { bmp: canvas, w: canvas.width, h: canvas.height, cleanup: () => {} };
  }

  // 2. TIFF decoding
  if (await isTiff(file)) {
    const canvas = await decodeTiffToCanvas(file);
    return { bmp: canvas, w: canvas.width, h: canvas.height, cleanup: () => {} };
  }

  // 3. Native createImageBitmap
  const needsImgFallback = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
  if (!needsImgFallback && "createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, {
        colorSpaceConversion: "default",
        premultiplyAlpha: "premultiply",
      } as ImageBitmapOptions);
      return { bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close?.() };
    } catch {
      // fall through to <img>
    }
  }

  // 4. HTMLImageElement fallback (SVG, ICO, etc.)
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = "async";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode this image."));
      el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return { bmp: img, w, h, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; isOffscreen: boolean } {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      return { canvas: new OffscreenCanvas(w, h), isOffscreen: true };
    } catch {
      // fall through
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, isOffscreen: false };
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mime: string,
  quality01?: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: mime, quality: quality01 } as any).then((b) => {
      if (!b) throw new Error(`Encoder returned nothing for ${mime}. Try PNG or JPG.`);
      return b;
    });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Encoder returned nothing for ${mime}. Try PNG or JPG.`))),
      mime,
      quality01,
    );
  });
}

export async function convertImage(
  file: File,
  opts: ConvertOptions,
  onProgress?: (ratio: number) => void,
): Promise<ConvertResult> {
  const started = performance.now();
  const target = opts.target.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  // ── 1. Target GIF (Really Good GIF Encoder or Standard) ────────────────────
  if (target === "gif") {
    const { blob, width, height } = await convertToGif(file, opts, onProgress);
    const elapsedMs = performance.now() - started;
    return {
      blob,
      width,
      height,
      mime: "image/gif",
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  }

  // ── 2. Target ICO (Multi-size favicon) ─────────────────────────────────────
  if (target === "ico") {
    const { blob, width, height } = await convertToIco(file);
    const elapsedMs = performance.now() - started;
    return {
      blob,
      width,
      height,
      mime: "image/x-icon",
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  }

  // ── 3. Target Video (Hardware GPU fast-path with FFmpeg WASM fallback) ───
  if (target === "mp4" || target === "webm") {
    try {
      const { blob, width, height, mime: outMime } = await convertVideo(
        file,
        target as "mp4" | "webm",
        opts,
        onProgress,
      );
      const elapsedMs = performance.now() - started;
      return {
        blob,
        width,
        height,
        mime: outMime,
        elapsedMs,
        fromBytes: file.size,
        toBytes: blob.size,
      };
    } catch {
      // Fallback to FFmpeg WASM worker for codecs unplayable by native browser video
      const args =
        target === "mp4"
          ? ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
          : ["-c:v", "libvpx-vp9"];
      const blob = await transcodeWithFFmpeg(file, target, args, onProgress);
      const elapsedMs = performance.now() - started;
      return {
        blob,
        mime: mimeFor(target),
        elapsedMs,
        fromBytes: file.size,
        toBytes: blob.size,
      };
    }
  }

  // ── 4. Target PDF ──────────────────────────────────────────────────────────
  if (target === "pdf") {
    let pdfBlob: Blob;
    const isDoc = ["txt", "md", "html"].includes(ext);
    if (isDoc) {
      const text = await file.text();
      pdfBlob = await convertTextToPdf(text, file.name);
    } else {
      pdfBlob = await convertImageToPdf(file);
    }
    const elapsedMs = performance.now() - started;
    return {
      blob: pdfBlob,
      mime: "application/pdf",
      elapsedMs,
      fromBytes: file.size,
      toBytes: pdfBlob.size,
    };
  }

  // ── 5. Target Audio (MP3, OGG, FLAC via FFmpeg WASM worker; WAV via Web Audio)
  if (["mp3", "ogg", "flac"].includes(target)) {
    const args =
      target === "mp3"
        ? ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"]
        : target === "ogg"
          ? ["-vn", "-c:a", "libvorbis", "-q:a", "4"]
          : ["-vn", "-c:a", "flac"];

    const blob = await transcodeWithFFmpeg(file, target, args, onProgress);
    const elapsedMs = performance.now() - started;
    return {
      blob,
      mime: mimeFor(target),
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  }

  if (target === "wav" || file.type.startsWith("audio/")) {
    try {
      const { blob } = await convertAudio(file, target);
      const elapsedMs = performance.now() - started;
      return {
        blob,
        mime: "audio/wav",
        elapsedMs,
        fromBytes: file.size,
        toBytes: blob.size,
      };
    } catch {
      // Fallback to FFmpeg WASM worker
      const blob = await transcodeWithFFmpeg(
        file,
        "wav",
        ["-vn", "-c:a", "pcm_s16le"],
        onProgress,
      );
      const elapsedMs = performance.now() - started;
      return {
        blob,
        mime: "audio/wav",
        elapsedMs,
        fromBytes: file.size,
        toBytes: blob.size,
      };
    }
  }

  // ── 6. Target Spreadsheets & Data (XLSX, CSV, JSON, HTML) ─────────────────
  if (["xlsx", "csv", "json"].includes(target) && (["xlsx", "xls", "csv", "json"].includes(ext) || file.type.includes("csv") || file.type.includes("json") || file.type.includes("spreadsheet"))) {
    const { blob, mime } = await convertSpreadsheet(file, target);
    const elapsedMs = performance.now() - started;
    return {
      blob,
      mime,
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  }

  // ── 6. Target Document markup (Markdown ↔ HTML ↔ TXT) ─────────────────────
  if (["html", "md", "txt"].includes(target) && ["html", "md", "txt"].includes(ext)) {
    const text = await file.text();
    let resultText = text;
    let mime = "text/plain";

    if (target === "html") {
      mime = "text/html";
      resultText = ext === "md" ? markdownToHtml(text) : `<pre>${text}</pre>`;
    } else if (target === "md") {
      mime = "text/markdown";
      resultText = ext === "html" ? htmlToMarkdown(text) : text;
    } else if (target === "txt") {
      resultText = ext === "html" ? htmlToMarkdown(text) : text;
    }

    const blob = new Blob([resultText], { type: mime });
    const elapsedMs = performance.now() - started;
    return {
      blob,
      mime,
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  }

  // ── 7. Standard Raster Images (PNG, JPG, WebP, AVIF, BMP, plus HEIC/TIFF) ─
  const mime = mimeFor(target);
  const { bmp, w: srcW, h: srcH, cleanup } = await decodeToBitmap(file);
  try {
    const { w, h } = computeOutputSize(srcW, srcH, opts);
    const { canvas } = makeCanvas(w, h);
    const ctx = (canvas as any).getContext("2d", { alpha: true, colorSpace: "srgb" }) as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Canvas 2D context unavailable.");

    const needsFlatten = target === "jpg" || target === "bmp";
    if (needsFlatten) {
      ctx.fillStyle = opts.background || "#ffffff";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const src: CanvasImageSource = bmp as unknown as CanvasImageSource;
    ctx.drawImage(src, 0, 0, w, h);

    const lossy = target === "jpg" || target === "webp" || target === "avif";
    const quality01 = lossy ? Math.min(1, Math.max(0.01, opts.quality / 100)) : undefined;
    let blob = await canvasToBlob(canvas, mime, quality01);

    if ((!blob || blob.size === 0) && target === "avif") {
      blob = await canvasToBlob(canvas, "image/webp", quality01);
    }

    const elapsedMs = performance.now() - started;
    return {
      blob,
      width: w,
      height: h,
      mime: blob.type || mime,
      elapsedMs,
      fromBytes: file.size,
      toBytes: blob.size,
    };
  } finally {
    cleanup();
  }
}

export function outputFileName(inputName: string, targetExt: string): string {
  const base = inputName.includes(".") ? inputName.slice(0, inputName.lastIndexOf(".")) : inputName;
  return `${base}.${targetExt}`;
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function savingsPercent(from: number, to: number): number {
  if (!from) return 0;
  return Math.round(((from - to) / from) * 100);
}
