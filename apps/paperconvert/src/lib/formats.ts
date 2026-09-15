// ─── PaperConvert format registry ───────────────────────────────────────────
// Fully client-side conversions powered by Web APIs, WASM, and in-browser encoders.

export interface FormatInfo {
  id: string; // extension, lowercase
  label: string;
  mime: string;
  extensions: string[];
  category: "image" | "video" | "audio" | "data" | "document" | "archive";
  decodable: boolean;
  encodable: "native" | "wasm" | "none";
  notes: string;
}

export const ALL_FORMATS: FormatInfo[] = [
  // Images
  { id: "png", label: "PNG", mime: "image/png", extensions: ["png"], category: "image", decodable: true, encodable: "native", notes: "Lossless. Best for graphics, screenshots, transparency." },
  { id: "jpg", label: "JPG", mime: "image/jpeg", extensions: ["jpg", "jpeg"], category: "image", decodable: true, encodable: "native", notes: "Lossy. Best for photos. Quality 0–100." },
  { id: "webp", label: "WebP", mime: "image/webp", extensions: ["webp"], category: "image", decodable: true, encodable: "native", notes: "Modern. ~30% smaller than JPG/PNG." },
  { id: "avif", label: "AVIF", mime: "image/avif", extensions: ["avif"], category: "image", decodable: true, encodable: "native", notes: "Next-gen AV1 codec. Smallest files." },
  { id: "gif", label: "GIF", mime: "image/gif", extensions: ["gif"], category: "image", decodable: true, encodable: "native", notes: "Animated or static. Features the Really Good GIF Encoder." },
  { id: "ico", label: "ICO", mime: "image/x-icon", extensions: ["ico"], category: "image", decodable: true, encodable: "native", notes: "Multi-size favicon container (16, 32, 48, 64px)." },
  { id: "bmp", label: "BMP", mime: "image/bmp", extensions: ["bmp"], category: "image", decodable: true, encodable: "native", notes: "Uncompressed bitmap." },
  { id: "svg", label: "SVG", mime: "image/svg+xml", extensions: ["svg"], category: "image", decodable: true, encodable: "none", notes: "Vector input. Rasterize to any size." },
  { id: "heic", label: "HEIC", mime: "image/heic", extensions: ["heic", "heif"], category: "image", decodable: true, encodable: "none", notes: "iPhone camera photo. Decodes locally." },
  { id: "tiff", label: "TIFF", mime: "image/tiff", extensions: ["tif", "tiff"], category: "image", decodable: true, encodable: "none", notes: "Print and scientific image. Decodes locally." },

  // Documents
  { id: "pdf", label: "PDF", mime: "application/pdf", extensions: ["pdf"], category: "document", decodable: true, encodable: "native", notes: "Portable Document Format. Created via pdf-lib." },
  { id: "txt", label: "TXT", mime: "text/plain", extensions: ["txt"], category: "document", decodable: true, encodable: "native", notes: "Plain text document." },
  { id: "md", label: "Markdown", mime: "text/markdown", extensions: ["md"], category: "document", decodable: true, encodable: "native", notes: "Markdown document." },
  { id: "html", label: "HTML", mime: "text/html", extensions: ["html", "htm"], category: "document", decodable: true, encodable: "native", notes: "HTML web page markup." },

  // Spreadsheets / Data
  { id: "xlsx", label: "XLSX", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"], category: "data", decodable: true, encodable: "native", notes: "Excel spreadsheet workbook." },
  { id: "xls", label: "XLS", mime: "application/vnd.ms-excel", extensions: ["xls"], category: "data", decodable: true, encodable: "none", notes: "Legacy Excel spreadsheet." },
  { id: "csv", label: "CSV", mime: "text/csv", extensions: ["csv"], category: "data", decodable: true, encodable: "native", notes: "Comma-separated values." },
  { id: "json", label: "JSON", mime: "application/json", extensions: ["json"], category: "data", decodable: true, encodable: "native", notes: "JavaScript Object Notation." },

  // Video
  { id: "mp4", label: "MP4", mime: "video/mp4", extensions: ["mp4"], category: "video", decodable: true, encodable: "native", notes: "MP4 H.264 video. Encodes locally via hardware." },
  { id: "webm", label: "WebM", mime: "video/webm", extensions: ["webm"], category: "video", decodable: true, encodable: "native", notes: "WebM VP8/VP9 video. Encodes locally via hardware." },
  { id: "mov", label: "MOV", mime: "video/quicktime", extensions: ["mov"], category: "video", decodable: true, encodable: "none", notes: "QuickTime in. Convert directly to MP4, WebM, or GIF." },

  // Audio
  { id: "wav", label: "WAV", mime: "audio/wav", extensions: ["wav"], category: "audio", decodable: true, encodable: "native", notes: "16-bit PCM uncompressed audio." },
  { id: "mp3", label: "MP3", mime: "audio/mpeg", extensions: ["mp3"], category: "audio", decodable: true, encodable: "wasm", notes: "MP3 audio encoded via FFmpeg WASM worker." },
  { id: "ogg", label: "OGG", mime: "audio/ogg", extensions: ["ogg"], category: "audio", decodable: true, encodable: "wasm", notes: "OGG Vorbis audio encoded via FFmpeg WASM worker." },
  { id: "flac", label: "FLAC", mime: "audio/flac", extensions: ["flac"], category: "audio", decodable: true, encodable: "wasm", notes: "FLAC lossless audio encoded via FFmpeg WASM worker." },
  { id: "m4a", label: "M4A", mime: "audio/x-m4a", extensions: ["m4a", "aac"], category: "audio", decodable: true, encodable: "none", notes: "AAC audio in." },
];

export const IMAGE_FORMATS = ALL_FORMATS.filter((f) => f.category === "image" || f.id === "pdf");
export const ENCODABLE_IMAGE_FORMATS = ALL_FORMATS.filter((f) => f.encodable === "native" && (f.category === "image" || f.id === "pdf"));

export function detectFormat(file: File): FormatInfo | undefined {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    ALL_FORMATS.find((f) => f.extensions.includes(ext)) ??
    ALL_FORMATS.find((f) => f.mime === file.type)
  );
}

export function detectImageFormat(file: File) {
  return detectFormat(file);
}

export function mimeFor(id: string): string {
  return ALL_FORMATS.find((f) => f.id === id)?.mime ?? "application/octet-stream";
}

export function getAvailableTargets(file: File): FormatInfo[] {
  const detected = detectFormat(file);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // 1. Video file targets: MP4, WebM, GIF, MP3, WAV (audio extraction), WebP, PNG, JPG
  if (detected?.category === "video" || file.type.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext)) {
    return [
      ALL_FORMATS.find((f) => f.id === "mp4")!,
      ALL_FORMATS.find((f) => f.id === "webm")!,
      ALL_FORMATS.find((f) => f.id === "gif")!,
      ALL_FORMATS.find((f) => f.id === "mp3")!,
      ALL_FORMATS.find((f) => f.id === "wav")!,
      ALL_FORMATS.find((f) => f.id === "webp")!,
      ALL_FORMATS.find((f) => f.id === "png")!,
      ALL_FORMATS.find((f) => f.id === "jpg")!,
    ].filter(Boolean);
  }

  // 2. Audio file targets: MP3, WAV, OGG, FLAC
  if (detected?.category === "audio" || file.type.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)) {
    return [
      ALL_FORMATS.find((f) => f.id === "mp3")!,
      ALL_FORMATS.find((f) => f.id === "wav")!,
      ALL_FORMATS.find((f) => f.id === "ogg")!,
      ALL_FORMATS.find((f) => f.id === "flac")!,
    ].filter(Boolean);
  }

  // 3. Spreadsheet / Data targets: XLSX, CSV, JSON, HTML
  if (detected?.category === "data" || ["xlsx", "xls", "csv", "json"].includes(ext)) {
    const list = [
      ALL_FORMATS.find((f) => f.id === "csv")!,
      ALL_FORMATS.find((f) => f.id === "json")!,
      ALL_FORMATS.find((f) => f.id === "xlsx")!,
      ALL_FORMATS.find((f) => f.id === "html")!,
    ].filter(Boolean);
    return list.filter((f) => f.id !== ext);
  }

  // 4. Document / Text targets: PDF, HTML, TXT, Markdown
  if (detected?.category === "document" || ["txt", "md", "html"].includes(ext)) {
    return [
      ALL_FORMATS.find((f) => f.id === "pdf")!,
      ALL_FORMATS.find((f) => f.id === "html")!,
      ALL_FORMATS.find((f) => f.id === "txt")!,
      ALL_FORMATS.find((f) => f.id === "md")!,
    ].filter(Boolean);
  }

  // 5. Image targets (PNG, JPG, WebP, AVIF, GIF, ICO, BMP, PDF)
  return [
    ALL_FORMATS.find((f) => f.id === "webp")!,
    ALL_FORMATS.find((f) => f.id === "png")!,
    ALL_FORMATS.find((f) => f.id === "jpg")!,
    ALL_FORMATS.find((f) => f.id === "avif")!,
    ALL_FORMATS.find((f) => f.id === "gif")!,
    ALL_FORMATS.find((f) => f.id === "ico")!,
    ALL_FORMATS.find((f) => f.id === "pdf")!,
    ALL_FORMATS.find((f) => f.id === "bmp")!,
  ].filter(Boolean);
}
