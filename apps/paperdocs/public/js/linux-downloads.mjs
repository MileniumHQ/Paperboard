// Paperboard ships for Linux as an AppImage, a deb and an rpm. The landing's
// detected download button picks Linux and an architecture but not a format,
// so it asks which one; the downloads page links each format directly.
const formats = [
    { id: 'appimage', label: 'AppImage', extension: 'AppImage', description: 'Runs on any distribution. Needs FUSE 2, and you make the file executable before opening it.' },
    { id: 'deb', label: 'deb', extension: 'deb', description: 'For Debian, Ubuntu, Linux Mint and Pop!_OS. Installs with your package manager.' },
    { id: 'rpm', label: 'rpm', extension: 'rpm', description: 'For Fedora, openSUSE and RHEL. Installs with your package manager.' },
];
const architectures = { x64: 'x64', arm64: 'ARM64' };

/** The Linux formats to offer for a detected Paperboard AppImage link, or null for any other link. */
export function linuxDownloads(href) {
    let url;
    try { url = new URL(href); }
    catch { return null; } // A non-URL is not a release download.
    if (url.origin !== 'https://i.paperboard.dev' || url.search || url.hash) return null;
    const match = /^\/pb\/latest\/paperboard-linux-(x64|arm64)\.AppImage$/.exec(url.pathname);
    if (!match) return null;
    const arch = match[1];
    return {
        architecture: architectures[arch],
        choices: formats.map(format => {
            const file = `paperboard-linux-${arch}.${format.extension}`;
            return { id: format.id, label: format.label, description: format.description, file, href: `https://i.paperboard.dev/pb/latest/${file}` };
        }),
    };
}
