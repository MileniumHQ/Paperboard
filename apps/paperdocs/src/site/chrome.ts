import { DOCS_LINKS, LEARN_LINKS, SITE_LINKS } from "./links";

// HTML for the landing's hand-written chrome. The landing keeps its own
// topbar/footer markup and CSS (the docs SPA has a different implementation);
// only the link contents are shared. scripts/prerender-site.ts injects these
// between the site-nav markers in public/index.html at build time.

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function dropdown(links: {
    label: string;
    href: string;
    image: string;
    description: string;
}[]): string {
    return [
        `                        <div class="site-topbar__dropdown" role="menu">`,
        ...links.map((link) =>
            [
                `                            <a class="site-topbar__item" role="menuitem" href="${escapeHtml(link.href)}">`,
                `                                <img class="site-topbar__item-icon" src="${escapeHtml(link.image)}" alt="" />`,
                `                                <span class="site-topbar__item-text"><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.description)}</small></span>`,
                `                            </a>`,
            ].join("\n"),
        ),
        `                        </div>`,
    ].join("\n");
}

function footerLink(label: string, href: string): string {
    return `                    <a class="site-footer__link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function mobileLink(label: string, href: string): string {
    return `                    <a class="site-topbar__mobile-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function mobileSection(heading: string, links: string): string {
    return [
        `                    <span class="site-topbar__mobile-heading">${escapeHtml(heading)}</span>`,
        links,
    ].join("\n");
}

export const landingChrome = {
    topbarLearn: dropdown(LEARN_LINKS),
    topbarDocs: dropdown(
        DOCS_LINKS.map((link) => ({
            label: link.label,
            href: link.href,
            image: link.image || "/paperboard.png",
            description: link.description || "",
        })),
    ),
    mobile: [
        mobileSection(
            "Learn",
            LEARN_LINKS.map((link) => mobileLink(link.label, link.href)).join(
                "\n",
            ),
        ),
        mobileSection(
            "Docs",
            DOCS_LINKS.map((link) => mobileLink(link.label, link.href)).join(
                "\n",
            ),
        ),
        mobileSection(
            "Site",
            SITE_LINKS.map((link) => mobileLink(link.label, link.href)).join(
                "\n",
            ),
        ),
    ].join("\n"),
    footerLearn: [
        footerLink("About Paperboard", "/"),
        ...LEARN_LINKS.map((link) => footerLink(link.label, link.href)),
    ].join("\n"),
    footerDocs: DOCS_LINKS.map((link) =>
        footerLink(link.label, link.href),
    ).join("\n"),
    footerSite: SITE_LINKS.map((link) =>
        footerLink(link.label, link.href),
    ).join("\n"),
};
