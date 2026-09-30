// Which elements of a docs page are table-of-contents entries, and at what
// depth. Only headings count: pages also put ids on non-headings (an SVG clip
// path inside a live demo), and those are not sections.
const LEVELS: Record<string, number> = {
    subheader: 0,
    title: 1,
    subtitle: 2,
    H2: 0,
    H3: 1,
    H4: 2,
};

export interface TocCandidate {
    tagName: string;
    getAttribute(name: string): string | null;
}

/** The heading's TOC depth, or null when the element is not a heading. */
export function tocLevel(el: TocCandidate): number | null {
    const preset = el.getAttribute("data-preset") ?? "";
    return LEVELS[preset] ?? LEVELS[el.tagName.toUpperCase()] ?? null;
}
