// ─── Future WASM bridge (placeholder) ───────────────────────────────────────
// The image pipeline above is 100% Web-API native. The milestones below plug
// in here WITHOUT touching UI code — FileRow/queue only depend on the
// `EngineConvert` signature.
//
//   images:  done — Canvas/OffscreenCanvas (this file's sibling module)
//   video:   FFmpeg.wasm (mp4/webm/mov/mkv/gif, AV1) — `convertVideo()` stub
//   audio:   FFmpeg.wasm + Web Audio (mp3/wav/ogg/flac) — `convertAudio()` stub
//   docs:    pdf-lib + print-to-PDF + docx — `convertDocument()` stub
//   raw:     libheif (HEIC), UTIF.js (TIFF), jpeg-xl ref — extend imageConverter

export interface EngineJob {
  file: File;
  target: string;
  options?: Record<string, unknown>;
  onProgress?: (ratio: number) => void;
}

export async function convertVideo(_job: EngineJob): Promise<Blob> {
  throw new Error(
    "Video conversion lands with the FFmpeg.wasm milestone. The queue UI, format pickers and Power-of-Local modal already support it — only this engine stub needs swapping.",
  );
}

export async function convertAudio(_job: EngineJob): Promise<Blob> {
  throw new Error(
    "Audio conversion lands with the Web Audio + FFmpeg.wasm milestone.",
  );
}

export async function convertDocument(_job: EngineJob): Promise<Blob> {
  throw new Error(
    "Document conversion lands with the pdf-lib/docx milestone.",
  );
}
