import { DOCS_LINKS, LEARN_LINKS, SITE_LINKS } from "../links";

// Static HTML fragments for the landing's custom-element hosts. BgOverlay,
// StyledText, and PaperButton are still custom elements upgraded by the plain
// scripts in public/js, so their markup is handed to Solid as innerHTML. These
// builders are the single source for that markup, shared with the client
// scripts' expectations of the same class names and attributes.

export function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function dropdownItems(links: { label: string; href: string; image: string; description: string }[]): string {
    return links
        .map(
            (link) =>
                `<a class="site-topbar__item" role="menuitem" href="${escapeHtml(link.href)}">` +
                `<img class="site-topbar__item-icon" src="${escapeHtml(link.image)}" alt="" />` +
                `<span class="site-topbar__item-text"><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.description)}</small></span>` +
                `</a>`,
        )
        .join("");
}

export const learnDropdownHtml = dropdownItems(LEARN_LINKS);

export const docsDropdownHtml = dropdownItems(
    DOCS_LINKS.map((link) => ({
        label: link.label,
        href: link.href,
        image: link.image || "/paperboard.png",
        description: link.description || "",
    })),
);

function mobileLink(label: string, href: string): string {
    return `<a class="site-topbar__mobile-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function mobileSection(heading: string, links: string): string {
    return `<span class="site-topbar__mobile-heading">${escapeHtml(heading)}</span>${links}`;
}

export const mobileMenuHtml = [
    mobileSection(
        "Learn",
        LEARN_LINKS.map((link) => mobileLink(link.label, link.href)).join(""),
    ),
    mobileSection(
        "Docs",
        DOCS_LINKS.map((link) => mobileLink(link.label, link.href)).join(""),
    ),
    mobileSection(
        "Site",
        SITE_LINKS.map((link) => mobileLink(link.label, link.href)).join(""),
    ),
].join("");

function footerLink(label: string, href: string): string {
    return `<a class="site-footer__link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

export const footerLearnHtml = [
    footerLink("About Paperboard", "/"),
    ...LEARN_LINKS.map((link) => footerLink(link.label, link.href)),
].join("");

export const footerDocsHtml = DOCS_LINKS.map((link) =>
    footerLink(link.label, link.href),
).join("");

export const footerSiteHtml = SITE_LINKS.map((link) =>
    footerLink(link.label, link.href),
).join("");
