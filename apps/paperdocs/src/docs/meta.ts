import index from "./index.json";
import type { SectionMeta } from "../types/docs";

// Section metadata is plain JSON so non-Vite consumers (the site prerender
// script) can read it without pulling in import.meta.glob.
export const metaSections: Record<string, SectionMeta> =
    (index as any).meta?.sections || {};

export const sectionKeys = Object.keys(metaSections);
