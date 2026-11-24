import assert from 'node:assert/strict';

// The topbar's "Paperboard" wordmark: textured on the dark bar, a plain title
// in light mode (the texture's white glyphs vanish on a light bar), and the
// landing pages' own dark chrome keeps its texture whatever the stored theme.
export async function checkTopbarWordmark(browser, origin) {
    // one context per stored theme, so each step's theme is the one it
    // names, and a fresh tab per page
    const inTheme = async (theme, check) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const errors = [];
        try {
            await context.addInitScript(value => localStorage.setItem('paper-docs-theme', value), theme);
            await check(async path => {
                const page = await context.newPage();
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(`${origin}${path}`);
                return page;
            });
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    };
    const wordmark = page => page.evaluate(() => {
        const mark = document.querySelector('.topbar-brand .paper-wordmark');
        const label = mark.querySelector('.paper-wordmark-plain');
        const host = mark.querySelector('.paper-wordmark-lettering');
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
    const plainTitle = { labelShown: true, labelIsText: true, textured: false };
    const pages = ['/downloads/', '/blog/', '/contact/'];

    await inTheme('light', async open => {
        for (const path of pages) {
            assert.deepEqual(await wordmark(await open(path)), plainTitle, `${path}: light mode shows the wordmark as a plain title`);
        }
        // the landing chrome isn't the topbar and stays textured
        const landing = await open('/');
        assert.equal(await landing.evaluate(() => getComputedStyle(document.querySelector('.site-topbar__name marketing-text')).display !== 'none'), true, 'The landing wordmark keeps its texture');
    });

    await inTheme('dark', async open => {
        for (const path of pages) {
            const { labelShown, textured } = await wordmark(await open(path));
            assert.equal(textured, true, `${path}: dark mode keeps the texture`);
            assert.equal(labelShown, false, `${path}: the textured wordmark shows no plain title beside it`);
        }
        // switching the theme from the topbar changes it in place (the init
        // script only runs on a load, so the toggle's choice stands)
        const page = await open('/downloads/');
        await page.locator('.topbar').getByRole('button', { name: 'Switch to light theme' }).click();
        await page.waitForFunction(() => document.documentElement.getAttribute('data-paperui-theme') === 'light');
        assert.deepEqual(await wordmark(page), plainTitle, 'The toggle turns the wordmark into a plain title at once');
    });
    console.log('verified the topbar wordmark: a plain title in light mode on three pages and after the toggle, textured in dark mode and on the landing');
}
