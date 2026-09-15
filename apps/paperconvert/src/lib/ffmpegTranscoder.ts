// ─── FFmpeg WASM Worker Transcoder ─────────────────────────────────────────
// Runs FFmpeg WASM in a background worker for universal audio and video encoding
// (MP3, OGG, FLAC, MKV, AVI, MP4, WebM) with zero server round-trips.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import coreURLAsset from "@ffmpeg/core?url";
import wasmURLAsset from "@ffmpeg/core/wasm?url";
import { mimeFor } from "./formats";

let ffmpegInstance: FFmpeg | null = null;
let isLoaded = false;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onStatus?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && isLoaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onStatus?.("Loading FFmpeg WASM worker...");
    const ffmpeg = new FFmpeg();
    ffmpegInstance = ffmpeg;

    const coreURL = await toBlobURL(coreURLAsset, "text/javascript");
    const wasmURL = await toBlobURL(wasmURLAsset, "application/wasm");

    await ffmpeg.load({
      coreURL,
      wasmURL,
    });

    isLoaded = true;
    return ffmpeg;
  })();

  return loadPromise;
}

export async function transcodeWithFFmpeg(
  file: File,
  targetExt: string,
  args: string[] = [],
  onProgress?: (ratio: number) => void,
  onStatus?: (msg: string) => void,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg(onStatus);

  const id = Math.random().toString(36).slice(2, 8);
  const ext = file.name.split(".").pop() || "bin";
  const inputName = `input_${id}.${ext}`;
  const outputName = `output_${id}.${targetExt}`;

  if (onProgress) {
    const progressHandler = ({ progress }: { progress: number }) => {
      onProgress(Math.min(0.99, Math.max(0.01, progress)));
    };
    ffmpeg.on("progress", progressHandler);
  }

  const arrayBuffer = await file.arrayBuffer();
  await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));

  const fullArgs = ["-i", inputName, ...args, outputName];
  await ffmpeg.exec(fullArgs);

  const outputData = await ffmpeg.readFile(outputName);

  await ffmpeg
    .deleteFile(inputName)
    .catch((err) => console.debug("[PaperConvert] temp input cleanup failed:", err));
  await ffmpeg
    .deleteFile(outputName)
    .catch((err) => console.debug("[PaperConvert] temp output cleanup failed:", err));

  const mime = mimeFor(targetExt);
  return new Blob([outputData as unknown as BlobPart], { type: mime });
}
