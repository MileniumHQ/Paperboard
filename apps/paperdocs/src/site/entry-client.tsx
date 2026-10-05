import { render } from "solid-js/web";
import "../index.css";
import { SiteTopbar } from "./SiteTopbar";
import { ContactForm } from "./pages/ContactForm";
import { startCarousel } from "./blogCarousel";

export async function showUnsignedDownload(download: import('../../public/js/unsigned-downloads.mjs').UnsignedDownload, trigger: HTMLElement) {
    const warning = await import('./DownloadWarning');
    warning.showUnsignedDownload(download, trigger);
}

// Islands are server-rendered for the static response, then re-rendered here
// in the browser. A client render (not hydrate) is deliberate: partial
// hydration is not supported by Solid's page-scoped hydration keys, and the
// static page text does not need behavior, only the interactive islands do.
//
// The shared base stylesheet is imported here because this entry, not
// SitePage, is the bundle root the browser loads.
//
// Root pages have a #site-topbar island (plus #site-contact on /contact). Docs
// pages have a #docs-root island; the docs app is imported only there so the
// root pages never download it or the search index.

const topbarRoot = document.getElementById("site-topbar");
if (topbarRoot) {
    topbarRoot.replaceChildren();
    render(() => <SiteTopbar />, topbarRoot);
}

const contactRoot = document.getElementById("site-contact");
if (contactRoot) {
    contactRoot.replaceChildren();
    render(() => <ContactForm />, contactRoot);
}

// Post carousels stay static markup; the script only moves and times them.
// They live as long as the page, so their teardown is never needed here.
for (const carousel of document.querySelectorAll<HTMLElement>("[data-carousel]")) {
    startCarousel(carousel);
}

const docsRoot = document.getElementById("docs-root");
if (docsRoot) {
    void import("../App").then(({ default: App }) => {
        docsRoot.replaceChildren();
        render(() => <App />, docsRoot);
    });
}
