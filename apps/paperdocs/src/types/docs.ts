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
}

export interface TocItem {
    id: string;
    text: string;
    level: number;
}
