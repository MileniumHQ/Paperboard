import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linuxDownloads } from '../public/js/linux-downloads.mjs';

describe('Linux download formats', () => {
    test('a detected AppImage link offers the AppImage, deb and rpm for its architecture', () => {
        for (const [arch, label] of [['x64', 'x64'], ['arm64', 'ARM64']]) {
            const offer = linuxDownloads(`https://i.paperboard.dev/pb/latest/paperboard-linux-${arch}.AppImage`)!;
            expect(offer.architecture).toBe(label);
            expect(offer.choices.map(choice => choice.href)).toEqual(
                ['AppImage', 'deb', 'rpm'].map(extension => `https://i.paperboard.dev/pb/latest/paperboard-linux-${arch}.${extension}`),
            );
        }
    });

    test('every offered file is one the downloads page publishes', () => {
        const page = readFileSync(join(import.meta.dir, '../src/site/pages/downloads.md'), 'utf8');
        for (const arch of ['x64', 'arm64']) {
            for (const choice of linuxDownloads(`https://i.paperboard.dev/pb/latest/paperboard-linux-${arch}.AppImage`)!.choices) {
                expect(page).toContain(`(${choice.href})`);
            }
        }
    });

    test('other links are not a Linux format question', () => {
        for (const href of [
            '/downloads', 'not a URL',
            'https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb',
            'https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe',
            'https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz',
            'https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage?x=1',
            'https://example.com/pb/latest/paperboard-linux-x64.AppImage',
        ]) expect(linuxDownloads(href)).toBeNull();
    });
});
