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
    icon?: string;
    image?: string;
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
    /** Base-relative route without the deployment prefix: "paperui/overview". */
    url: string;
}
