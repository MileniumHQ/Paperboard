// ─── Browser PDF & Document Converter ──────────────────────────────────────
// Powered by pdf-lib: generates vector/raster PDFs from images, text, and markdown.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function convertImageToPdf(file: File): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // Rasterize image to standard PNG/JPG canvas to ensure clean embedding
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image for PDF conversion."));
      el.src = url;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable.");
    ctx.drawImage(img, 0, 0, w, h);

    const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
    const mime = isJpeg ? "image/jpeg" : "image/png";
    const imgBlob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), mime, 0.95));
    const arrayBuffer = await imgBlob.arrayBuffer();

    const embedded = isJpeg
      ? await pdfDoc.embedJpg(arrayBuffer)
      : await pdfDoc.embedPng(arrayBuffer);

    // Standard A4 dimensions or matching image aspect ratio
    const maxWidth = 595.28; // A4 pt width
    const maxHeight = 841.89; // A4 pt height
    const scale = Math.min(maxWidth / w, maxHeight / h, 1);

    const pageW = w * scale;
    const pageH = h * scale;

    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageW,
      height: pageH,
    });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function convertTextToPdf(text: string, title: string = "Document"): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageW = 595.28;
  const pageH = 841.89;
  const contentW = pageW - margin * 2;
  const fontSize = 11;
  const lineHeight = 16;

  let page = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - margin;

  // Title header
  page.drawText(title, {
    x: margin,
    y: cursorY,
    size: 18,
    font: boldFont,
    color: rgb(0.06, 0.38, 0.78),
  });
  cursorY -= 30;

  // Split lines and wrap
  const rawLines = text.split(/\r?\n/);
  for (const rawLine of rawLines) {
    const words = rawLine.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const textWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (textWidth > contentW && currentLine) {
        if (cursorY < margin + lineHeight) {
          page = pdfDoc.addPage([pageW, pageH]);
          cursorY = pageH - margin;
        }
        page.drawText(currentLine, {
          x: margin,
          y: cursorY,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        cursorY -= lineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      if (cursorY < margin + lineHeight) {
        page = pdfDoc.addPage([pageW, pageH]);
        cursorY = pageH - margin;
      }
      page.drawText(currentLine, {
        x: margin,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= lineHeight;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text for an HTML body or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

// links and images may point at the web, mail, or a relative path; a
// javascript:/data: target would run when the converted file is opened
function safeUrl(escapedUrl: string): string {
  const url = escapedUrl.trim();
  return /^(https?:|mailto:)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "#";
}

// Inline HTML that Markdown documents commonly carry. Bare tags only: no
// attributes, so nothing here can hold a handler or a URL.
const SAFE_INLINE_TAGS = "br|hr|kbd|b|i|u|s|em|strong|del|ins|mark|small|sub|sup|code";
const SAFE_TAG_PATTERN = new RegExp(`&lt;(/?)(${SAFE_INLINE_TAGS})\\s*(/?)&gt;`, "gi");

export function markdownToHtml(md: string): string {
  // escape first, then hand back only the allow-listed bare tags: the
  // markdown rules below add the rest of the markup, so source text can
  // never contribute any other element or attribute
  let html = escapeHtml(md)
    .replace(SAFE_TAG_PATTERN, (_m, close: string, tag: string, selfClose: string) =>
      `<${close}${tag.toLowerCase()}${selfClose && !close ? " /" : ""}>`,
    )
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*)\*/gim, "<em>$1</em>")
    .replace(/!\[(.*?)\]\((.*?)\)/gim, (_m, alt: string, src: string) => `<img alt="${alt}" src="${safeUrl(src)}" />`)
    .replace(/\[(.*?)\]\((.*?)\)/gim, (_m, label: string, href: string) => `<a href="${safeUrl(href)}">${label}</a>`)
    .replace(/\n\n/gim, "</p><p>")
    .replace(/\n/gim, "<br />");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Document</title><style>body{font-family:sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px;color:#222;}</style></head><body><p>${html}</p></body></html>`;
}

export function htmlToMarkdown(html: string): string {
  return html
    // script and style are not content: drop them with their bodies, not
    // just their tags, so code never lands in the document as text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // an unterminated tag ("<script" with no ">") survives the strip above
    .replace(/<[a-z!/?][^>]*$/i, "")
    .trim();
}
