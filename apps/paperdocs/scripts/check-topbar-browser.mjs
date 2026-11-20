import assert from 'node:assert/strict';

// The topbar's "Paperboard" wordmark: textured on the dark bar, a plain title
// in light mode (the texture's white glyphs vanish on a light bar), and the
// landing pages' own dark chrome keeps its texture whatever the stored theme.
export async function checkTopbarWordmark(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const wordmark = () => page.evaluate(() => {
            const mark = document.querySelector('.topbar-brand .paper-wordmark');
            const label = mark.querySelector('.paper-wordmark-label');
            const host = mark.querySelector('.styled-text-host');
            const probe = document.createElement('span');
            probe.style.color = 'var(--paper-text)';
            document.body.append(probe);
            const text = getComputedStyle(probe).color;
            probe.remove();
            const box = label.getBoundingClientRect();
            return {
                labelShown: box.width > 1 && box.height > 1,
                labelIsText: getComputedStyle(label).color === text,
                textured: getComputedStyle(host).display !== 'none',
            };
        });
        const setTheme = theme => page.addInitScript(value => localStorage.setItem('paper-docs-theme', value), theme);

        for (const path of ['/downloads/', '/blog/', '/contact/']) {
            await setTheme('light');
            await page.goto(`${origin}${path}`);
            assert.deepEqual(await wordmark(), { labelShown: true, labelIsText: true, textured: false }, `${path}: light mode shows the wordmark as a plain title`);
            await setTheme('dark');
            await page.goto(`${origin}${path}`);
            assert.equal((await wordmark()).textured, true, `${path}: dark mode keeps the texture`);
            assert.equal((await wordmark()).labelShown, false, `${path}: the textured wordmark's label is only for screen readers`);
        }

        // switching the theme from the topbar changes it in place
        await page.goto(`${origin}/downloads/`);
        await page.locator('.topbar').getByRole('button', { name: 'Switch to light theme' }).click();
        await page.waitForFunction(() => document.documentElement.getAttribute('data-paperui-theme') === 'light');
        assert.deepEqual(await wordmark(), { labelShown: true, labelIsText: true, textured: false }, 'The toggle turns the wordmark into a plain title at once');

        // the landing chrome isn't the topbar and stays textured
        await setTheme('light');
        await page.goto(`${origin}/`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.site-topbar__name .styled-text-host')).display !== 'none'), true, 'The landing wordmark keeps its texture');
        assert.deepEqual(errors, []);
        console.log('verified the topbar wordmark: a plain title in light mode on three pages and after the toggle, textured in dark mode and on the landing');
    } finally { await context.close(); }
}
