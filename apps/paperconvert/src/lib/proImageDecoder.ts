// ─── Pro Image Decoder (HEIC, TIFF) ─────────────────────────────────────────
// Decodes iOS HEIC/HEIF photos and scientific/print TIFF images directly in-browser
// to raw ImageData / Canvas, allowing them to convert to any format.

import decodeHeic from "heic-decode";
import UTIF from "utif";

export async function isHeic(file: File): Promise<boolean> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif";
}

export async function isTiff(file: File): Promise<boolean> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "tif" || ext === "tiff" || file.type === "image/tiff";
}

export async function decodeHeicToCanvas(file: File): Promise<HTMLCanvasElement> {
  const arrayBuffer = await file.arrayBuffer();
  const { width, height, data } = await decodeHeic({ buffer: arrayBuffer });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const imageData = ctx.createImageData(width, height);
  imageData.data.set(new Uint8Array(data));
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

export async function decodeTiffToCanvas(file: File): Promise<HTMLCanvasElement> {
  const arrayBuffer = await file.arrayBuffer();
  const ifds = UTIF.decode(arrayBuffer);
  if (!ifds || ifds.length === 0) throw new Error("Invalid or unsupported TIFF image.");

  const firstIfd = ifds[0];
  UTIF.decodeImage(arrayBuffer, firstIfd);
  const rgba = UTIF.toRGBA8(firstIfd);

  const width = firstIfd.width;
  const height = firstIfd.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}
