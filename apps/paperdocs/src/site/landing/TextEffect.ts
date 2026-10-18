/** The landing's existing styled-text element owns the texture and shadows. */
export function styledText(text: string, size: number, fluid = false): string {
    const escaped = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    // The text attribute is there when the element upgrades during parsing,
    // before its child text exists, so it renders the right words first time.
    return `<styled-text size="${size}" text="${escaped}"${fluid ? " fluid" : ""}>${escaped}</styled-text>`;
}
