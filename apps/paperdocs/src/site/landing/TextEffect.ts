/** The landing's existing styled-text element owns the texture and shadows. */
export function styledText(text: string, size: number): string {
    const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<styled-text size="${size}">${escaped}</styled-text>`;
}
