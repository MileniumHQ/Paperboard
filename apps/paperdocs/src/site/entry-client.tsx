import { render } from "solid-js/web";
import "../index.css";
import { SiteTopbar } from "./SiteTopbar";
import { ContactForm } from "./pages/ContactForm";

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

const topbarRoot = document.getElementById("site-topbar");
if (topbarRoot) {
    topbarRoot.replaceChildren();
    render(() => <SiteTopbar />, topbarRoot);
}

// Contact lives only on /contact; every other prerendered page has no such
// node, so the form bundle is inert there.
const contactRoot = document.getElementById("site-contact");
if (contactRoot) {
    contactRoot.replaceChildren();
    render(() => <ContactForm />, contactRoot);
}
