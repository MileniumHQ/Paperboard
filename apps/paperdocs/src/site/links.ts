import { metaSections } from "../docs/meta";
import nav from "./nav.json";
import { LEARN_PANELS } from "./learn/panels";

// One source of link contents for the two chrome implementations: the docs
// SPA (Solid components) and the static root site (landing HTML injected at
// build time, prerendered pages rendered from these values). Docs sections
// come from src/docs/index.json so a new section lands in both menus.
export const BRAND = nav.brand;
export const LEARN_LINKS = LEARN_PANELS.map(panel => ({
    label: panel.name, href: `/${panel.slug}`, image: panel.icon, description: panel.summary,
}));
export const SITE_LINKS = nav.site;
export const DOWNLOAD = nav.download;

export const DOCS_LINKS = Object.entries(metaSections).map(([key, meta]) => ({
    label: meta.name,
    href: `/docs/${key}/`,
    image: meta.image,
    icon: meta.icon,
    description: meta.description,
}));
