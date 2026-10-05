// One policy for every download entry point, including links inside shadow DOM.
const files = new Map([
    ['paperboard-windows-x64-setup.exe', ['pb', 'windows']],
    ['paperboard-macos-arm64.dmg', ['pb', 'macos']],
    ['paperboard-macos-x64.dmg', ['pb', 'macos']],
    ['crane-windows-x64.zip', ['crane', 'windows']],
    ['crane-macos-arm64.tar.gz', ['crane', 'macos']],
    ['crane-macos-x64.tar.gz', ['crane', 'macos']],
]);

export function unsignedDownload(href) {
    let url;
    try { url = new URL(href); }
    catch { return null; } // A non-URL is not a direct release download.
    if (url.origin !== 'https://i.paperboard.dev' || url.search || url.hash) return null;
    const [, app, version, file, ...extra] = url.pathname.split('/');
    const match = files.get(file);
    if (!match || extra.length || version !== 'latest' || match[0] !== app) return null;
    return { platform: match[1], app: app === 'pb' ? 'Paperboard' : 'Paperboard server daemon', file, href: url.href };
}

export const installationGuidance = {
    windows: {
        label: 'Windows',
        summary: 'This build is unsigned. Windows may show a SmartScreen warning or an unknown publisher when you open it.',
        steps: [
            'Download the file and open the installer or extracted executable.',
            'If SmartScreen says it protected your PC, select More info. Check that this is the file you downloaded here.',
            'If you trust this download and Run anyway is available, select it to continue.',
        ],
        note: 'Smart App Control or a managed device may block unsigned apps without offering Run anyway. If that happens, contact your administrator or use another supported device.',
        source: 'https://support.microsoft.com/en-us/windows/security/windows-security/app-browser-control-in-the-windows-security-app',
        sourceLabel: 'About Windows app protection',
    },
    macos: {
        label: 'macOS',
        summary: 'This build is unsigned and not notarized. macOS may say it cannot verify the developer or check the app for malicious software.',
        steps: [
            'For Paperboard, open the DMG and drag the app to Applications, then try opening it. For the server daemon, extract the download.',
            'If it is blocked because the developer cannot be verified, open System Settings, then Privacy & Security.',
            'If you trust this download, find Open Anyway and confirm Open when prompted.',
        ],
        note: 'If macOS says the app is damaged or will harm your computer, stop and contact us. Managed devices may not allow an exception.',
        source: 'https://support.apple.com/en-us/102445',
        sourceLabel: 'Apple’s installation guidance',
    },
};

export const unsignedExplanation = 'Paperboard is still in alpha, and these builds do not yet have a verified developer signature. A signature lets your operating system check who published an app and whether the signed files have changed. Without one, it asks you to decide whether to trust the download.';
