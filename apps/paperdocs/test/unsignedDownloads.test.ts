import { describe, expect, test } from 'bun:test';
import { unsignedDownload, installationGuidance } from '../public/js/unsigned-downloads.mjs';

describe('unsigned release downloads', () => {
    test('both apps and both Mac architectures select their actual download platform', () => {
        for (const [app, file, platform] of [
            ['pb', 'paperboard-windows-x64-setup.exe', 'windows'],
            ['pb', 'paperboard-macos-arm64.zip', 'macos'],
            ['pb', 'paperboard-macos-x64.zip', 'macos'],
            ['crane', 'crane-windows-x64.zip', 'windows'],
            ['crane', 'crane-macos-arm64.tar.gz', 'macos'],
            ['crane', 'crane-macos-x64.tar.gz', 'macos'],
        ]) {
            const href = `https://i.paperboard.dev/${app}/latest/${file}`;
            expect(unsignedDownload(href)).toMatchObject({ platform, file, href });
        }
    });

    test('Linux, navigation and other origins do not receive an unsigned Windows or Mac warning', () => {
        for (const href of [
            '/downloads', 'mailto:contact@example.com', 'not a URL',
            'https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage',
            'https://i.paperboard.dev/crane/latest/crane-linux-arm64.tar.gz',
            'https://example.com/pb/latest/paperboard-windows-x64-setup.exe',
            'https://i.paperboard.dev.evil.test/pb/latest/paperboard-windows-x64-setup.exe',
            'https://i.paperboard.dev/crane/latest/paperboard-windows-x64-setup.exe',
            'https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe/extra',
        ]) expect(unsignedDownload(href)).toBeNull();
    });

    test('guidance distinguishes unsigned warnings from a damaged app or an unavailable override', () => {
        expect(installationGuidance.windows.note).toContain('without offering Run anyway');
        expect(installationGuidance.macos.note).toContain('damaged');
        expect(installationGuidance.macos.note).toContain('stop and contact us');
    });
});
