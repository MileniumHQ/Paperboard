export interface Page {
    pageKey: string;
    name: string;
    file: string;
    subKey: string;
    index?: number;
}

export interface Subsection {
    key: string;
    name: string;
    icon?: string;
    pages: Page[];
}

export interface SectionMeta {
    name: string;
    /** The top bar's "<brand> docs" when the name reads wrong there ("Developer" for "Developers"). */
    brand?: string;
    icon?: string;
    /** The section's logo: its card on the docs home and its top bar brand. */
    image: string;
    description?: string;
    /** Sections sharing a group render together after the primary ones. */
    group?: string;
}

export interface TocItem {
    id: string;
    text: string;
    level: number;
}

/** One searchable docs page, built at compile time by vite-plugin-docs-search. */
export interface SearchRecord {
    section: string;
    sectionName: string;
    subsection: string;
    subsectionName: string;
    page: string;
    pageName: string;
    title: string;
    headings: string[];
    body: string;
}
