// The panel library reads an installed panel's manifest and listing media,
// nothing else: never HTML (the serve path injects credentials into it),
// never scripts, and never more than the listing caps allow. Shared by every
// shell host's panel-listing-file channel.
export const LISTING_FILE_MAX_BYTES = 2 * 1024 * 1024;
const LISTING_FILE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg", ".md"]);

export function isListingFilePath(subpath: string): boolean {
    if (subpath === "manifest.json") return true;
    const segments = subpath.split(/[\\/]/);
    if (segments.includes("..")) return false;
    const name = segments[segments.length - 1] ?? "";
    const dot = name.lastIndexOf(".");
    return dot > 0 && LISTING_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}
