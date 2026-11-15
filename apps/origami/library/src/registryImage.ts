// The registry hosts every image a record names (its icon and its
// screenshots) and the page loads them from its own origin, the way
// Download fetches only the archive the registry hosts. An image the
// record places anywhere else is dropped, never loaded.
import type { PanelItem } from "@mileniumhq/paperapi/panelMerge";
import type { StoreListing, StoreScreenshot } from "@mileniumhq/paperapi/storeListing";
import { REGISTRY_ORIGIN } from "origami/downloadUrl";

/** The image's path on this page's origin, or undefined when the registry does not host it. */
export function registryImage(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const parsed = URL.parse(url, window.location.href);
    if (!parsed || (parsed.origin !== window.location.origin && parsed.origin !== REGISTRY_ORIGIN)) return undefined;
    return `${parsed.pathname}${parsed.search}`;
}

function registryStore(store: StoreListing): StoreListing {
    const screenshots = store.screenshots.flatMap((shot): StoreScreenshot[] => {
        const light = registryImage(shot.light);
        if (!light) return [];
        const dark = registryImage(shot.dark);
        return [{ light, ...(dark ? { dark } : {}), ...(shot.alt ? { alt: shot.alt } : {}) }];
    });
    return { ...store, screenshots };
}

/** A merged panel with only the registry-hosted images its record names. */
export function withRegistryImages(panel: PanelItem): PanelItem {
    const { iconUrl, store, ...rest } = panel;
    const icon = registryImage(iconUrl);
    return { ...rest, ...(icon ? { iconUrl: icon } : {}), ...(store ? { store: registryStore(store) } : {}) };
}
