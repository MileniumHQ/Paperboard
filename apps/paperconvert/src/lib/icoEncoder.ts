// ─── Browser ICO Encoder ───────────────────────────────────────────────────
// Generates standard multi-resolution Windows / Web .ico containers with PNG-encoded frames.

export async function convertToIco(
  file: File,
  sizes: number[] = [16, 32, 48, 64],
): Promise<{ blob: Blob; width: number; height: number }> {
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image for ICO generation."));
      el.src = imgUrl;
    });

    const pngBuffers: Uint8Array[] = [];

    for (const size of sizes) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, size, size);

      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      const arrayBuf = await blob.arrayBuffer();
      pngBuffers.push(new Uint8Array(arrayBuf));
    }

    const count = pngBuffers.length;
    const headerSize = 6;
    const dirEntrySize = 16;
    let offset = headerSize + dirEntrySize * count;

    const totalSize = offset + pngBuffers.reduce((acc, b) => acc + b.byteLength, 0);
    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    // ICONDIR header
    view.setUint16(0, 0, true); // reserved
    view.setUint16(2, 1, true); // type 1 = ICO
    view.setUint16(4, count, true); // image count

    for (let i = 0; i < count; i++) {
      const buf = pngBuffers[i];
      const size = sizes[i];
      const dirOffset = headerSize + i * dirEntrySize;

      out[dirOffset + 0] = size >= 256 ? 0 : size;
      out[dirOffset + 1] = size >= 256 ? 0 : size;
      out[dirOffset + 2] = 0; // palette count
      out[dirOffset + 3] = 0; // reserved
      view.setUint16(dirOffset + 4, 1, true); // color planes
      view.setUint16(dirOffset + 6, 32, true); // bits per pixel
      view.setUint32(dirOffset + 8, buf.byteLength, true); // size in bytes
      view.setUint32(dirOffset + 12, offset, true); // byte offset

      out.set(buf, offset);
      offset += buf.byteLength;
    }

    const icoBlob = new Blob([out], { type: "image/x-icon" });
    const maxSz = Math.max(...sizes);
    return { blob: icoBlob, width: maxSz, height: maxSz };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}
