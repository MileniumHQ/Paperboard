import assert from 'node:assert/strict';

// Runs against the distributed documents served by check-learn-browser.
// Release bytes are intercepted; these checks never run an installer.
export async function checkDownloads(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgentData', { value: {
                platform: 'Windows',
                getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64' }),
            } });
        });
        await context.route('https://i.paperboard.dev/**', route => route.fulfill({
            body: 'Download browser fixture',
            headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fixture.bin"' },
        }));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let downloads = 0;
        page.on('download', () => downloads++);
        await page.goto(`${origin}/downloads/`);
        // Downloads is introduced by the shared PaperPageHeader (icon chip,
        // title, subtitle) like the blog and contact pages. Its title is a
        // PaperText span, not an h1, so assert the visible title in the page
        // column rather than a heading role.
        assert.equal(await page.locator('main').getByText('Downloads', { exact: true }).count(), 1);
        assert.equal(await page.getByRole('heading', { name: 'Paperboard server daemon', exact: true }).count(), 1);
        assert.equal(await page.locator('main ul').count(), 2, 'Each product has a plain text list');
        assert.equal(await page.locator('main a[href^="https://i.paperboard.dev/"]').count(), 10, 'Both products retain every architecture');
        assert.equal(await page.locator('main a[href^="https://i.paperboard.dev/"]').filter({ hasText: /^Download$/ }).count(), 0, 'Links identify the architecture rather than repeating Download');

        for (const [app, file, os] of [
            ['pb', 'paperboard-windows-x64-setup.exe', 'Windows'],
            ['pb', 'paperboard-macos-arm64.dmg', 'macOS'],
            ['pb', 'paperboard-macos-x64.dmg', 'macOS'],
            ['crane', 'crane-windows-x64.zip', 'Windows'],
            ['crane', 'crane-macos-arm64.tar.gz', 'macOS'],
            ['crane', 'crane-macos-x64.tar.gz', 'macOS'],
        ]) {
            const href = `https://i.paperboard.dev/${app}/latest/${file}`;
            const link = page.locator(`a[href="${href}"]`);
            await link.click();
            const modal = page.getByRole('dialog', { name: `Installing on ${os}` });
            await modal.waitFor();
            await page.waitForFunction(() => document.activeElement?.classList.contains('download-warning'));
            assert.equal(downloads, 0, 'No release request before explicit Download');
            assert.equal(await modal.locator('.download-warning__download').getAttribute('href'), href);
            assert.equal(await modal.locator('.download-warning__filename').innerText(), file);
            assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');
            // Shared PaperModal owns focus traversal and animated dismissal.
            await page.keyboard.press('Shift+Tab');
            assert.equal(await modal.locator('.download-warning__download').evaluate(node => node === document.activeElement), true);
            await page.keyboard.press('Tab');
            assert.equal(await modal.getByRole('button', { name: 'Close modal' }).evaluate(node => node === document.activeElement), true);
            await page.keyboard.press('Escape');
            await page.locator('.download-warning').waitFor({ state: 'detached' });
            assert.equal(await modal.count(), 0);
            assert.equal(await link.evaluate(node => node === document.activeElement), true, 'Dismissal restores the selected download link');
            assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
        }
        const windows = page.locator('a[href$="paperboard-windows-x64-setup.exe"]');
        await windows.click();
        await page.waitForFunction(() => document.activeElement?.classList.contains('download-warning'));
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden', 'The page remains locked while the shared modal fades out');
        await page.keyboard.press('Enter');
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        assert.equal(await windows.evaluate(node => node === document.activeElement), true);
        assert.equal(downloads, 0, 'Rapid input during dismissal must not start a download');
        await windows.click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('dialog').count(), 0);
        await windows.click();
        await page.getByRole('button', { name: 'Close modal' }).click();
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        await windows.click();
        await page.getByRole('dialog', { name: 'Installing on Windows' }).waitFor();
        await page.mouse.click(5, 5);
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('dialog').count(), 0, 'Backdrop dismisses the modal');
        await windows.click();
        const requested = page.waitForEvent('download');
        await page.getByRole('dialog').getByRole('link', { name: 'Download', exact: true }).click();
        const release = await requested;
        assert.equal(release.url(), 'https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe');
        await release.cancel();
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('dialog').count(), 0);
        const linuxDownload = page.waitForEvent('download');
        await page.locator('a[href$="paperboard-linux-x64.AppImage"]').click();
        await (await linuxDownload).cancel();
        assert.equal(await page.getByRole('dialog').count(), 0, 'Linux downloads proceed directly');
        await page.goto(`${origin}/contact/`);
        await page.goBack();
        await windows.click();
        await page.getByRole('dialog', { name: 'Installing on Windows' }).waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.download-warning').waitFor({ state: 'detached' });

        for (const path of ['/', '/actions/', '/bot-creator/', '/ai/', '/game-server/']) {
            await page.goto(`${origin}${path}`);
            const trigger = page.locator('.site-topbar__download paper-button').getByRole('link', { name: 'Download', exact: true });
            await trigger.waitFor();
            await trigger.focus();
            await page.keyboard.press('Enter');
            await page.getByRole('dialog', { name: 'Installing on Windows' }).waitFor();
            await page.keyboard.press('Escape');
            await page.locator('.download-warning').waitFor({ state: 'detached' });
            assert.equal(await trigger.evaluate(node => node.getRootNode().activeElement === node), true, 'Shadow DOM download regains focus');
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${origin}/downloads/`);
        assert.equal(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'Text downloads fit the mobile viewport');
        await page.locator('a[href$="paperboard-macos-arm64.dmg"]').click();
        const mac = page.getByRole('dialog', { name: 'Installing on macOS' });
        await mac.waitFor();
        assert.equal(await mac.locator('a.download-warning__source').getAttribute('href'), 'https://support.apple.com/en-us/102445');
        assert.ok((await mac.innerText()).includes('Privacy & Security'));
        assert.ok(await mac.evaluate(node => node.getBoundingClientRect().width <= innerWidth && node.clientWidth >= node.scrollWidth), 'Mobile modal must fit without horizontal clipping');
        // A site-level `.paperui-root` reset must not defeat the dialog's own
        // clipping, or header/footer surfaces bleed past its rounded corners.
        // Block margins must not stack on top of the body's flex gap.
        assert.deepEqual(await mac.evaluate(() => {
            const dialog = document.querySelector('.download-warning');
            const paragraph = dialog.querySelector('p');
            return { overflow: getComputedStyle(dialog).overflow, paragraphMarginTop: getComputedStyle(paragraph).marginTop };
        }), { overflow: 'hidden', paragraphMarginTop: '0px' }, 'Dialog clips to its rounded corners and uses its gap for block spacing');
        await page.keyboard.press('Escape');
        await page.locator('.download-warning').waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('dialog').count(), 0, 'Reduced motion dismissal stays immediate');
        assert.deepEqual(errors, []);
        console.log('verified unsigned download warnings for both apps, all six Windows/macOS releases, five marketing pages, keyboard/focus/backdrop, exact downloads, Linux and mobile/reduced motion');
    } finally { await context.close(); }
}
