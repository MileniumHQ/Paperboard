import type { ConvertOptions } from "./imageConverter";
import { DEFAULT_OPTIONS } from "./imageConverter";
import { detectFormat } from "./formats";

export type JobStatus = "queued" | "converting" | "done" | "error";

export interface ConvertJob {
  id: string;
  file: File;
  previewUrl: string;
  fromFmt: string;
  target: string;
  options: ConvertOptions;
  status: JobStatus;
  progress: number;
  error?: string;
  resultUrl?: string;
  resultBytes?: number;
  resultW?: number;
  resultH?: number;
  elapsedMs?: number;
}

let seq = 0;
export function makeJob(file: File): ConvertJob {
  seq += 1;
  const detected = detectFormat(file);
  const ext = file.name.split(".").pop()?.toLowerCase() || "file";
  const from = detected?.id ?? ext;

  let defaultTarget = "webp";
  if (detected?.category === "video" || file.type.startsWith("video/")) {
    defaultTarget = "gif";
  } else if (detected?.category === "audio" || file.type.startsWith("audio/")) {
    defaultTarget = "wav";
  } else if (from === "csv") {
    defaultTarget = "json";
  } else if (from === "json") {
    defaultTarget = "csv";
  } else if (from === "webp") {
    defaultTarget = "png";
  }

  // Create preview URL for images and videos
  const isAudioOrData = file.type.startsWith("audio/") || ["csv", "json"].includes(from);
  const previewUrl = isAudioOrData ? "" : URL.createObjectURL(file);

  return {
    id: `${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl,
    fromFmt: from,
    target: defaultTarget,
    options: {
      ...DEFAULT_OPTIONS,
      target: defaultTarget,
      reallyGoodGif: true, // Default to Tenor-optimized GIF
    },
    status: "queued",
    progress: 0,
  };
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
